/**
 * AccommodationManager over the JSON provider, in a temporary folder that each
 * test creates and removes, and nothing else.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import { buildAddonHost } from '@jwilleke/ngdpbase-types/testing';
import AccommodationManager, { createProvider, AccommodationRefusedError, type AccommodationAuditRecord } from '../managers/AccommodationManager.js';
import { categoriesFrom } from '../managers/categories.js';
import { lateChargesFrom } from '../managers/lateCharges.js';
import { FAIRWAYS_LATE_CHARGES, FAIRWAYS_CATEGORIES, SAMPLE_ACCOMMODATIONS } from './fixtures.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const host = buildAddonHost('accommodation', defaults);

/** Who may do what, for the test's decision point. */
const GRANTS: Record<string, string[]> = { treasurer: ['accommodation-read', 'accommodation-manage'], board: ['accommodation-read'] };

/** A person's context, as the session middleware writes the subject. */
function contextFor(username: string): ActorContext {
  return { username, roles: [], isAuthenticated: true, ipAddress: '192.0.2.1' } as unknown as ActorContext;
}

describe('AccommodationManager', () => {
  let dataPath: string;
  let bumps: number;
  let audits: AccommodationAuditRecord[];
  let auditFails: boolean;
  const treasurer = contextFor('treasurer');
  const board = contextFor('board');
  const wiring = () => ({
    host,
    decide: async (c: ActorContext, { action }: { action: string }) => ({
      permit: (GRANTS[(c as { username?: string }).username ?? ''] ?? []).includes(action), applicable: true, reason: 'test'
    }),
    recordAudit: async (record: AccommodationAuditRecord) => {
      if (auditFails) throw new Error('audit sink down');
      audits.push(record);
    }
  });
  const ctx = contextFor('treasurer');

  async function open(units = SAMPLE_ACCOMMODATIONS): Promise<AccommodationManager> {
    writeFileSync(path.join(dataPath, 'accommodations.json'), JSON.stringify(units));
    const manager = new AccommodationManager({
      ...wiring(),
      provider: await createProvider('json', dataPath),
      categories: categoriesFrom(FAIRWAYS_CATEGORIES),
      lateCharges: lateChargesFrom(FAIRWAYS_LATE_CHARGES),
      bump: async () => { bumps++; }
    });
    await manager.initialize();
    return manager;
  }

  beforeEach(() => {
    dataPath = mkdtempSync(path.join(tmpdir(), 'accommodation-'));
    bumps = 0;
    audits = [];
    auditFails = false;
  });
  afterEach(() => { rmSync(dataPath, { recursive: true, force: true }); });

  test('loads accommodations and passes every field through', async () => {
    const m = await open();
    expect(m.providerName).toBe('json');
    expect(m.count()).toBe(3);
    expect(m.get('66-00001.000')).toMatchObject({ sqft: 1500, marketValue: 200000, city: 'Mount Vernon' });
  });

  test('no file yet is no accommodations, and the folder is made', async () => {
    const sub = path.join(dataPath, 'new');
    const m = new AccommodationManager({ ...wiring(), provider: await createProvider('json', sub), categories: new Map() });
    await m.initialize();
    expect(m.count()).toBe(0);
  });

  test('an unknown provider is refused, naming the known ones', async () => {
    await expect(createProvider('sql', dataPath)).rejects.toThrow('unknown provider "sql" (known: json)');
  });

  test('search matches any field, ignoring case', async () => {
    const m = await open();
    expect(m.search('CORNER').map(u => u.id)).toEqual(['66-00002.000']);
    expect(m.search('mount vernon').map(u => u.id)).toEqual(['66-00001.000']);
    expect(m.search('105').map(u => u.id)).toEqual(['66-00003.000']);
    expect(m.search('').length).toBe(3);
  });

  test('category and assessment come from the configured category', async () => {
    const m = await open();
    expect(m.category('66-00001.000')?.name).toBe('C Model');
    expect(m.assessment('66-00002.000')).toEqual({ accommodationCategory: 'D', amount: 58400, period: 'monthly', datedue: 1 });
    expect(m.assessment('66-00003.000')).toBeNull(); // category Z is not configured
    expect(m.assessment('no-such-unit')).toBeNull();
  });

  test('lateCharges gives the rules, and a caller cannot change them', async () => {
    const m = await open();
    const rules = m.lateCharges();
    expect(rules.map(r => r.id)).toEqual(['late-10', 'late-60']);
    rules[0]!.amount = 1;
    expect(m.lateCharges()[0]!.amount).toBe(1000);
  });

  test('upsert and delete save through the provider and bump the cache once each', async () => {
    const m = await open();
    await m.upsert(treasurer, { id: '66-00004.000', accommodationCategory: 'A' });
    expect(await m.delete(treasurer, '66-00001.000')).toBe(true);
    expect(await m.delete(treasurer, 'nope')).toBe(false);
    expect(bumps).toBe(2);
    const saved = JSON.parse(readFileSync(path.join(dataPath, 'accommodations.json'), 'utf8')) as { id: string }[];
    expect(saved.map(u => u.id).sort()).toEqual(['66-00002.000', '66-00003.000', '66-00004.000']);
  });

  test('a change is recorded as accommodation-manage, by the caller, with field names only', async () => {
    const m = await open();
    await m.upsert(treasurer, { ...m.get('66-00002.000')!, notes: 'new roof', sqft: 1900 });
    await m.upsert(treasurer, { id: '66-00009.000', accommodationCategory: 'A' });
    await m.delete(treasurer, '66-00003.000');
    expect(audits.map(a => [a.eventType, a.action, a.resource, a.user])).toEqual([
      ['accommodation-manage', 'accommodation-update', '66-00002.000', 'treasurer'],
      ['accommodation-manage', 'accommodation-create', '66-00009.000', 'treasurer'],
      ['accommodation-manage', 'accommodation-delete', '66-00003.000', 'treasurer']
    ]);
    expect(audits[0]!.metadata.fields).toEqual(['notes']); // sqft unchanged; never the values
    expect(JSON.stringify(audits[0])).not.toContain('new roof');
  });

  test('a caller without accommodation-manage is refused, and nothing changes or is recorded', async () => {
    // Sabotage check: with authorize() ignoring the decision, this test went red (2026-10-22).
    const m = await open();
    await expect(m.upsert(board, { id: '66-00009.000' })).rejects.toBeInstanceOf(AccommodationRefusedError);
    await expect(m.delete(board, '66-00001.000')).rejects.toMatchObject({ name: 'AccommodationRefusedError', permission: 'accommodation-manage', decision: { permit: false } });
    expect(m.count()).toBe(3);
    expect(audits).toEqual([]);
    expect(bumps).toBe(0);
  });

  test('policy decides, not the role name: an "admin" role without the grant is refused, a plain role with it allowed', async () => {
    const m = await open();
    const namedAdmin = { username: 'board', roles: ['admin'], isAuthenticated: true } as unknown as ActorContext;
    const plain = { username: 'treasurer', roles: ['reader'], isAuthenticated: true } as unknown as ActorContext;
    await expect(m.upsert(namedAdmin, { id: '66-00009.000' })).rejects.toBeInstanceOf(AccommodationRefusedError);
    await m.upsert(plain, { id: '66-00009.000' });
    expect(m.get('66-00009.000')).toBeDefined();
  });

  test('a change whose record cannot be written does not happen (on-failure refuse)', async () => {
    // Sabotage check: with the audit moved after write(), this test went red (2026-10-22).
    const m = await open();
    auditFails = true;
    await expect(m.upsert(treasurer, { id: '66-00009.000' })).rejects.toThrow('audit sink down');
    await expect(m.delete(treasurer, '66-00001.000')).rejects.toThrow('audit sink down');
    expect(m.count()).toBe(3);
    expect(bumps).toBe(0);
    const saved = JSON.parse(readFileSync(path.join(dataPath, 'accommodations.json'), 'utf8')) as unknown[];
    expect(saved).toHaveLength(3);
  });

  test('upsert refuses an accommodation without a parcel id', async () => {
    const m = await open();
    await expect(m.upsert(treasurer, { id: '' })).rejects.toThrow('accommodation.id');
    expect(bumps).toBe(0);
  });
});
