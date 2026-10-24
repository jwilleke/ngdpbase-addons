/**
 * OccupancyManager over core's in-memory add-on database, opened under this add-on's own
 * declaration (so a test fails where a site would refuse it). Nothing is written to disk.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import OccupancyManager, { type OccupancyAuditRecord, type OccupancyDb } from '../managers/OccupancyManager.js';
import { ASSOCIATION_LEDGER_TABLE, ASSOCIATION_MIGRATIONS } from '../managers/migrations.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const host = buildAddonHost('association', defaults);
const visitor = { username: 'anonymous', roles: ['anonymous'], isAuthenticated: false, ipAddress: '192.0.2.9' } as unknown as ActorContext;

const ANSWERS = {
  email: 'lee@example.org', firstName: 'Lee', lastName: 'Renter', entryType: 'Occupant', unit: '66-00001.000',
  from: '2026-10-01', to: '', homePhone: '555-0100', working: 'No', managedBy: 'The owner'
};

describe('OccupancyManager.queue (#32)', () => {
  let db: OccupancyDb & { close(): void; prepare(sql: string): { all(): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown } };
  let audits: OccupancyAuditRecord[];
  let notices: string[];
  let order: string[];
  let auditFails: boolean;

  beforeEach(() => {
    db = openAddonTestDatabase('association', { migrations: ASSOCIATION_MIGRATIONS as never, ledgerTable: ASSOCIATION_LEDGER_TABLE },
      { slug: 'association', defaults });
    audits = []; notices = []; order = []; auditFails = false;
  });
  afterEach(() => { db.close(); });

  function open(): OccupancyManager {
    return new OccupancyManager({
      db, host,
      recordAudit: async (record) => {
        if (auditFails) throw new Error('audit sink down');
        order.push(`audit:${record.result}`);
        audits.push(record);
      },
      checkEntry: (e) => (e.parcel === '66-00001.000' ? (e.to !== 'current' && e.to < e.from ? 'ends before it starts' : null) : `no accommodation ${e.parcel}`),
      notifyReviewers: async (_title, message) => { order.push('notice'); notices.push(message); },
      now: () => new Date('2026-10-24T12:00:00Z')
    });
  }

  const rows = () => db.prepare('SELECT * FROM association_occupancy_submissions').all() as Array<Record<string, string>>;

  test('keeps a submission as pending, recorded first, then tells the reviewers', async () => {
    const m = open();
    expect(await m.queue(visitor, { id: 's-1', submittedBy: 'anonymous', formVersion: '0.1.0', data: ANSWERS })).toEqual({ ok: true });
    expect(order).toEqual(['audit:success', 'notice']);
    expect(rows()).toEqual([expect.objectContaining({ id: 's-1', unit: '66-00001.000', entry_type: 'occupant', status: 'pending', submitted_by: 'anonymous', received_at: '2026-10-24T12:00:00.000Z' })]);
    expect(JSON.parse(rows()[0].answers)).toEqual(ANSWERS);
    expect(audits[0]).toMatchObject({ action: 'occupancy-submit-occupant', resource: '66-00001.000', ipAddress: '192.0.2.9',
      metadata: { submissionId: 's-1', entryType: 'occupant', fields: ['email', 'entryType', 'firstName', 'from', 'homePhone', 'lastName', 'managedBy', 'unit', 'working'] } });
    // the record names the questions answered, never the answers; the notice names no person
    expect(JSON.stringify(audits[0])).not.toMatch(/lee@example|Renter|555-0100/);
    expect(notices).toEqual(['A submission for unit 66-00001.000 (occupant) waits for review.']);
    expect(m.pendingCount()).toBe(1);
  });

  test.each([
    [{ entryType: 'Tenant' }, { fields: { entryType: 'Choose Owner or Occupant' } }],
    [{ email: ' ' }, { fields: { email: 'An email is required' } }],
    [{ unit: '99-99999.000' }, { error: 'Not accepted: no accommodation 99-99999.000' }],
    [{ to: '2026-09-01' }, { error: 'Not accepted: ends before it starts' }]
  ])('refuses %o, keeping and recording nothing', async (change, refusal) => {
    const m = open();
    expect(await m.queue(visitor, { id: 's-2', submittedBy: 'anonymous', data: { ...ANSWERS, ...change } })).toMatchObject({ ok: false, ...refusal });
    expect(order).toEqual([]);
    expect(rows()).toEqual([]);
  });

  test('a record that cannot be written refuses the submission: nothing is kept, nobody is told', async () => {
    const m = open();
    auditFails = true;
    await expect(m.queue(visitor, { id: 's-3', submittedBy: 'anonymous', data: ANSWERS })).rejects.toThrow('audit sink down');
    expect(rows()).toEqual([]);
    expect(notices).toEqual([]);
  });

  test('a row that cannot be kept is recorded as a failure and thrown; nobody is told', async () => {
    const m = open();
    await m.queue(visitor, { id: 'dup', submittedBy: 'anonymous', data: ANSWERS });
    order = []; notices = [];
    await expect(m.queue(visitor, { id: 'dup', submittedBy: 'anonymous', data: ANSWERS })).rejects.toThrow();
    expect(order).toEqual(['audit:success', 'audit:failure']);
    expect(notices).toEqual([]);
    expect(m.pendingCount()).toBe(1);
  });
});
