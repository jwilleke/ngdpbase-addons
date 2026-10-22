/**
 * CondoUnitManager over the JSON provider, in a temporary folder that each
 * test creates and removes, and nothing else.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import { buildAddonHost } from '@jwilleke/ngdpbase-types/testing';
import CondoUnitManager, { createProvider, CondoRefusedError, type CondoAuditRecord, type DirectoryBackupParts } from '../managers/CondoUnitManager.js';
import { unitTypesFrom } from '../managers/unitTypes.js';
import { lateChargesFrom } from '../managers/lateCharges.js';
import { FAIRWAYS_LATE_CHARGES, FAIRWAYS_UNIT_TYPES, SAMPLE_UNITS, SAMPLE_USERS } from './fixtures.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const host = buildAddonHost('condo', defaults);

/** Who may do what, for the test's decision point. */
const GRANTS: Record<string, string[]> = { treasurer: ['condo-read', 'condo-manage'], board: ['condo-read'] };

/** A person's context, as the session middleware writes the subject. */
function contextFor(username: string): ActorContext {
  return { username, roles: [], isAuthenticated: true, ipAddress: '192.0.2.1' } as unknown as ActorContext;
}

describe('CondoUnitManager', () => {
  let dataPath: string;
  let bumps: number;
  let asked: unknown[];
  let audits: CondoAuditRecord[];
  let auditFails: boolean;
  const treasurer = contextFor('treasurer');
  const board = contextFor('board');
  const wiring = () => ({
    host,
    decide: async (c: ActorContext, { action }: { action: string }) => ({
      permit: (GRANTS[(c as { username?: string }).username ?? ''] ?? []).includes(action), applicable: true, reason: 'test'
    }),
    recordAudit: async (record: CondoAuditRecord) => {
      if (auditFails) throw new Error('audit sink down');
      audits.push(record);
    }
  });
  const ctx = contextFor('treasurer');

  async function open(units = SAMPLE_UNITS): Promise<CondoUnitManager> {
    writeFileSync(path.join(dataPath, 'units.json'), JSON.stringify(units));
    const manager = new CondoUnitManager({
      ...wiring(),
      dataPath,
      provider: await createProvider('json', dataPath),
      unitTypes: unitTypesFrom(FAIRWAYS_UNIT_TYPES),
      lateCharges: lateChargesFrom(FAIRWAYS_LATE_CHARGES),
      users: async (ctx) => { asked.push(ctx); return SAMPLE_USERS; },
      bump: async () => { bumps++; }
    });
    await manager.initialize();
    return manager;
  }

  beforeEach(() => {
    dataPath = mkdtempSync(path.join(tmpdir(), 'condo-units-'));
    bumps = 0;
    asked = [];
    audits = [];
    auditFails = false;
  });
  afterEach(() => { rmSync(dataPath, { recursive: true, force: true }); });

  test('loads units and passes every field through', async () => {
    const m = await open();
    expect(m.providerName).toBe('json');
    expect(m.count()).toBe(3);
    expect(m.get('66-00001.000')).toMatchObject({ sqft: 1500, marketValue: 200000, city: 'Mount Vernon' });
  });

  test('no file yet is no units, and the folder is made', async () => {
    const sub = path.join(dataPath, 'new');
    const m = new CondoUnitManager({ ...wiring(), dataPath: sub, provider: await createProvider('json', sub), unitTypes: new Map() });
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

  test('owners come from the user records: given shares kept, the rest split evenly', async () => {
    const m = await open();
    expect(await m.owners(ctx, '66-00001.000')).toEqual([
      { username: 'pat.example', name: 'Pat Example', email: 'pat@example.org', share: 60 },
      { username: 'sam.example', name: 'Sam Example', email: null, share: 40 }
    ]);
    // sam.example owns two units; a single parcel string still reads; no displayName falls back to the username
    expect(await m.owners(ctx, '66-00002.000')).toEqual([
      { username: 'kim.both', name: 'kim.both', email: null, share: 50 },
      { username: 'sam.example', name: 'Sam Example', email: null, share: 50 }
    ]);
    expect(await m.owners(ctx, '66-00003.000')).toEqual([]);
    expect(asked.every(c => c === ctx)).toBe(true); // users are read as the caller
  });

  test('occupants are the users marked occupant, never billed', async () => {
    const m = await open();
    expect((await m.occupants(ctx, '66-00001.000')).map(o => o.username)).toEqual(['lee.renter']);
    expect((await m.occupants(ctx, '66-00002.000')).map(o => o.username)).toEqual(['kim.both']);
  });

  test('owners refuses shares over 100%', async () => {
    const m = await open([{ id: '66-00001.000', shares: { 'pat.example': 70, 'sam.example': 40 } }]);
    await expect(m.owners(ctx, '66-00001.000')).rejects.toThrow('110%');
  });

  test('no user source is no owners', async () => {
    const m = new CondoUnitManager({ ...wiring(), dataPath, provider: await createProvider('json', dataPath), unitTypes: new Map() });
    await m.initialize();
    expect(await m.owners(ctx, '66-00001.000')).toEqual([]);
  });

  test('unit type and assessment come from the configured type', async () => {
    const m = await open();
    expect(m.unitType('66-00001.000')?.name).toBe('C Model');
    expect(m.assessment('66-00002.000')).toEqual({ unitType: 'D', amount: 58400, period: 'monthly', datedue: 1 });
    expect(m.assessment('66-00003.000')).toBeNull(); // type Z is not configured
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
    await m.upsert(treasurer, { id: '66-00004.000', unitType: 'A' });
    expect(await m.delete(treasurer, '66-00001.000')).toBe(true);
    expect(await m.delete(treasurer, 'nope')).toBe(false);
    expect(bumps).toBe(2);
    const saved = JSON.parse(readFileSync(path.join(dataPath, 'units.json'), 'utf8')) as { id: string }[];
    expect(saved.map(u => u.id).sort()).toEqual(['66-00002.000', '66-00003.000', '66-00004.000']);
  });

  test('backup and restore go through core\'s directory helpers, and the restore is staged', async () => {
    const calls: unknown[][] = [];
    const parts: DirectoryBackupParts = {
      backupDirectoryPart: async (...a) => { calls.push(['backup', ...a]); return { managerName: 'CondoUnitManager', timestamp: 't', data: { format: 1, archive: 's.condo.tar' } }; },
      stageDirectoryPart: async (...a) => { calls.push(['stage', ...a]); },
      applyDirectoryPartAtStart: (...a) => { calls.push(['apply', ...a]); return null; }
    };
    const configManager = {};
    writeFileSync(path.join(dataPath, 'units.json'), JSON.stringify(SAMPLE_UNITS));
    const m = new CondoUnitManager({ ...wiring(), dataPath, backupParts: parts, configManager, provider: await createProvider('json', dataPath), unitTypes: new Map() });
    await m.initialize();
    const opts = { ctx, directory: '/backups', stem: 's' };
    const backup = await m.backup(opts);
    await m.restore(backup, { ctx, directory: '/backups', siteRestore: '/site-restore.json' });
    expect(m.restoreIsStaged()).toBe(true);
    expect(calls).toEqual([
      ['apply', 'CondoUnitManager', dataPath, configManager],
      ['backup', 'CondoUnitManager', 'condo', dataPath, opts],
      ['stage', 'CondoUnitManager', dataPath, backup, { ctx, directory: '/backups', siteRestore: '/site-restore.json' }]
    ]);
    expect(m.count()).toBe(3); // the restore staged; nothing in the running site changed
  });

  test('a staged restore is put in place before the units are read', async () => {
    // Sabotage check: with apply moved after provider.loadUnits(), this test went red (2026-10-22).
    writeFileSync(path.join(dataPath, 'units.json'), JSON.stringify(SAMPLE_UNITS));
    const parts: DirectoryBackupParts = {
      backupDirectoryPart: async () => { throw new Error('unused'); },
      stageDirectoryPart: async () => { throw new Error('unused'); },
      applyDirectoryPartAtStart: () => { writeFileSync(path.join(dataPath, 'units.json'), JSON.stringify([{ id: 'restored' }])); return null; }
    };
    const m = new CondoUnitManager({ ...wiring(), dataPath, backupParts: parts, configManager: {}, provider: await createProvider('json', dataPath), unitTypes: new Map() });
    await m.initialize();
    expect(m.list().map(u => u.id)).toEqual(['restored']);
  });

  test('on a core without the helpers, backup throws (reported incomplete) and restore refuses', async () => {
    const m = await open();
    expect(m.restoreIsStaged()).toBe(true);
    await expect(m.backup({ ctx, directory: '/b', stem: 's' })).rejects.toThrow('condo units are not in this backup');
    await expect(m.restore({ managerName: 'CondoUnitManager', timestamp: 't' }, { ctx, directory: '/b' })).rejects.toThrow('nothing was staged');
    expect(m.count()).toBe(3);
  });

  test('a change is recorded as condo-manage, by the caller, with field names only', async () => {
    const m = await open();
    await m.upsert(treasurer, { ...m.get('66-00002.000')!, notes: 'new roof', sqft: 1900 });
    await m.upsert(treasurer, { id: '66-00009.000', unitType: 'A' });
    await m.delete(treasurer, '66-00003.000');
    expect(audits.map(a => [a.eventType, a.action, a.resource, a.user])).toEqual([
      ['condo-manage', 'unit-update', '66-00002.000', 'treasurer'],
      ['condo-manage', 'unit-create', '66-00009.000', 'treasurer'],
      ['condo-manage', 'unit-delete', '66-00003.000', 'treasurer']
    ]);
    expect(audits[0]!.metadata.fields).toEqual(['notes']); // sqft unchanged; never the values
    expect(JSON.stringify(audits[0])).not.toContain('new roof');
  });

  test('a caller without condo-manage is refused, and nothing changes or is recorded', async () => {
    // Sabotage check: with authorize() ignoring the decision, this test went red (2026-10-22).
    const m = await open();
    await expect(m.upsert(board, { id: '66-00009.000' })).rejects.toBeInstanceOf(CondoRefusedError);
    await expect(m.delete(board, '66-00001.000')).rejects.toMatchObject({ name: 'CondoRefusedError', permission: 'condo-manage', decision: { permit: false } });
    expect(m.count()).toBe(3);
    expect(audits).toEqual([]);
    expect(bumps).toBe(0);
  });

  test('policy decides, not the role name: an "admin" role without the grant is refused, a plain role with it allowed', async () => {
    const m = await open();
    const namedAdmin = { username: 'board', roles: ['admin'], isAuthenticated: true } as unknown as ActorContext;
    const plain = { username: 'treasurer', roles: ['reader'], isAuthenticated: true } as unknown as ActorContext;
    await expect(m.upsert(namedAdmin, { id: '66-00009.000' })).rejects.toBeInstanceOf(CondoRefusedError);
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
    const saved = JSON.parse(readFileSync(path.join(dataPath, 'units.json'), 'utf8')) as unknown[];
    expect(saved).toHaveLength(3);
  });

  test('upsert refuses a unit without a parcel id', async () => {
    const m = await open();
    await expect(m.upsert(treasurer, { id: '' })).rejects.toThrow('unit.id');
    expect(bumps).toBe(0);
  });
});
