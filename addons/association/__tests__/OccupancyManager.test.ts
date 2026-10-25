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
  email: 'lee@example.org', firstName: 'Lee', lastName: 'Renter', existingOwner: 'No', unit: '66-00001.000',
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
      decide: async () => ({ permit: true, applicable: true, reason: 'test' }),
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
    expect(rows()).toEqual([expect.objectContaining({ id: 's-1', unit: '66-00001.000', entry_type: 'owner', status: 'pending', submitted_by: 'anonymous', received_at: '2026-10-24T12:00:00.000Z' })]);
    expect(JSON.parse(rows()[0].answers)).toEqual(ANSWERS);
    expect(audits[0]).toMatchObject({ action: 'occupancy-submit-owner', resource: '66-00001.000', ipAddress: '192.0.2.9',
      metadata: { submissionId: 's-1', entryType: 'owner', fields: ['email', 'existingOwner', 'firstName', 'from', 'homePhone', 'lastName', 'managedBy', 'unit', 'working'] } });
    // the record names the questions answered, never the answers; the notice names no person
    expect(JSON.stringify(audits[0])).not.toMatch(/lee@example|Renter|555-0100/);
    expect(notices).toEqual(['A submission for unit 66-00001.000 (owner) waits for review.']);
    expect(m.pendingCount()).toBe(1);
  });

  test.each([
    [{ existingOwner: 'Maybe' }, { fields: { existingOwner: 'Choose Yes or No' } }],
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

describe('OccupancyManager review (#33)', () => {
  let db: OccupancyDb & { close(): void; prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown } };
  let audits: OccupancyAuditRecord[];
  let calls: string[];
  let fail: Record<string, string>;
  let accounts: Array<{ username: string; email?: string }>;
  const reviewer = { username: 'board.member', roles: [], isAuthenticated: true, ipAddress: '192.0.2.5' } as unknown as ActorContext;
  const stranger = { username: 'nobody', roles: ['admin'], isAuthenticated: true } as unknown as ActorContext;

  beforeEach(() => {
    db = openAddonTestDatabase('association', { migrations: ASSOCIATION_MIGRATIONS as never, ledgerTable: ASSOCIATION_LEDGER_TABLE }, { slug: 'association', defaults });
    audits = []; calls = []; fail = {};
    accounts = [{ username: 'lee.renter', email: 'Lee@Example.org' }];
  });
  afterEach(() => { db.close(); });

  function open(): OccupancyManager {
    return new OccupancyManager({
      db, host,
      decide: async (c) => ({ permit: (c as { username?: string }).username === 'board.member', applicable: true, reason: 'test' }),
      recordAudit: async (record) => { calls.push(`audit:${record.metadata['entryType'] ? record.action : ''}:${record.result}`); audits.push(record); },
      checkEntry: () => null,
      notifyReviewers: async () => undefined,
      approval: {
        searchUsers: async (c, email) => { calls.push(`search:${email}`); expect(c).toBe(reviewer); return accounts; },
        addEntry: async (c, username, entry) => {
          calls.push(`add:${username}:${entry.type}:${entry.share ?? ''}`);
          if (fail['add']) throw Object.assign(new Error(fail['add']), { name: 'LinkChangeRefusedError' });
          return { type: entry.type, index: 0, expected: '{}' };
        },
        removeEntry: async (_c, username) => { calls.push(`remove:${username}`); if (fail['remove']) throw new Error(fail['remove']); },
        findPerson: async (_c, username) => (username === 'test.visitor' ? { id: 'urn:uuid:new', contactPoint: [] } : username === 'lee.renter' ? { id: 'urn:uuid:lee', contactPoint: [{ '@type': 'ContactPoint', contactType: 'home', telephone: 'old' }, { '@type': 'ContactPoint', contactType: 'fax', telephone: 'keep' }] } : null),
        updatePerson: async (_c, id, patch) => { calls.push(`person:${id}:${JSON.stringify(patch)}`); if (fail['person']) throw new Error(fail['person']); },
        createUser: async (c, user) => {
          calls.push(`create:${user.username}:${user.email}:${user.displayName}`); expect(c).toBe(reviewer);
          if (fail['create']) throw new Error(fail['create']);
          accounts = [{ username: user.username, email: user.email }];
          return { username: user.username };
        },
        inviteUser: async (_c, username) => { calls.push(`invite:${username}`); return fail['invite'] ? { outcome: 'email-unavailable', reason: fail['invite'] } : { outcome: 'sent' }; },
        // a stand-in for accommodation's mapping, which accommodation's own tests cover
        contactDetails: (a) => ({ contactPoint: [
          ...(a['homeMailingAddress'] ? [{ '@type': 'PostalAddress' as const, contactType: 'mailing', streetAddress: String(a['homeMailingAddress']) }] : []),
          ...(a['homePhone'] ? [{ '@type': 'ContactPoint' as const, contactType: 'home', telephone: String(a['homePhone']) }] : []),
          ...(a['emergencyName'] ? [{ '@type': 'ContactPoint' as const, contactType: 'emergency', name: String(a['emergencyName']), telephone: String(a['emergencyPhone']) }] : [])
        ] })
      }
    });
  }
  const status = (id: string) => (db.prepare('SELECT status FROM association_occupancy_submissions WHERE id = ?').get(id) as { status: string }).status;
  async function queued(m: OccupancyManager, id: string, data: Record<string, unknown> = ANSWERS): Promise<void> {
    await m.queue(visitor, { id, submittedBy: 'anonymous', data });
    calls = []; audits = [];
  }

  test('pending lists what waits, oldest first; refused without association-review', async () => {
    const m = open();
    await queued(m, 'a');
    expect((await m.pending(reviewer)).map(s => [s.id, s.unit, s.entryType, s.answers['email']])).toEqual([['a', '66-00001.000', 'owner', 'lee@example.org']]);
    // a role named admin does not stand in for the permission
    await expect(m.pending(stranger)).rejects.toMatchObject({ name: 'OccupancyRefusedError', permission: 'association-review' });
  });

  test('reject: recorded first, then the submission leaves the list; a second decision is refused', async () => {
    const m = open();
    await queued(m, 'a');
    await m.reject(reviewer, 'a');
    expect(status('a')).toBe('rejected');
    expect(audits[0]).toMatchObject({ user: 'board.member', action: 'occupancy-reject', result: 'success', metadata: { submissionId: 'a' } });
    expect(await m.pending(reviewer)).toEqual([]);
    await expect(m.reject(reviewer, 'a')).rejects.toThrow('already rejected');
    await expect(m.reject(stranger, 'a')).rejects.toMatchObject({ name: 'OccupancyRefusedError' });
  });

  test('approve: finds the one account, records first, adds the entry, writes the details in schema.org shape, marks it approved', async () => {
    const m = open();
    await queued(m, 'a', { ...ANSWERS, homeMailingAddress: 'PO Box 1', emergencyName: 'Kim', emergencyPhone: '555-0199', agentName: '' });
    expect(await m.approve(reviewer, 'a', { share: 100 })).toEqual({ username: 'lee.renter', created: false });
    expect(calls.slice(0, 3)).toEqual(['search:lee@example.org', 'audit:occupancy-approve:success', 'add:lee.renter:owner:100']);
    const patch = JSON.parse(calls[3].replace('person:urn:uuid:lee:', '')) as { contactPoint: Array<Record<string, string>> };
    expect(patch.contactPoint).toEqual([
      { '@type': 'ContactPoint', contactType: 'fax', telephone: 'keep' }, // a kind this form does not write is kept
      { '@type': 'PostalAddress', contactType: 'mailing', streetAddress: 'PO Box 1' },
      { '@type': 'ContactPoint', contactType: 'home', telephone: '555-0100' }, // replaces the old home phone
      { '@type': 'ContactPoint', contactType: 'emergency', name: 'Kim', telephone: '555-0199' }
    ]);
    expect(status('a')).toBe('approved');
    expect(JSON.stringify(audits)).not.toMatch(/555-0100|PO Box/);
  });

  test('approve an owner needs the share; it goes with the entry', async () => {
    const m = open();
    await queued(m, 'o', ANSWERS);
    await expect(m.approve(reviewer, 'o')).rejects.toThrow("an owner's share");
    expect(calls).toEqual(['search:lee@example.org']);
    await m.approve(reviewer, 'o', { share: 50 });
    expect(calls).toContain('add:lee.renter:owner:50');
  });

  test.each([
    [[], 'no account has the email lee@example.org; give a username for a new one'],
    [[{ username: 'a', email: 'lee@example.org' }, { username: 'b', email: 'LEE@example.org' }], 'more than one account'],
    [[{ username: 'leeway', email: 'lee@example.org.uk' }], 'no account has the email']
  ])('approve never guesses the account: %o', async (found, message) => {
    const m = open();
    await queued(m, 'a');
    accounts = found;
    await expect(m.approve(reviewer, 'a', { share: 100 })).rejects.toThrow(message);
    expect(calls.filter(c => !c.startsWith('search'))).toEqual([]);
    expect(status('a')).toBe('pending');
  });

  test('details that cannot be written: the entry is removed again, the submission stays pending, the failure is recorded', async () => {
    const m = open();
    await queued(m, 'a');
    fail['person'] = 'contact store down';
    await expect(m.approve(reviewer, 'a', { share: 100 })).rejects.toThrow('contact store down');
    expect(calls.filter(c => !c.startsWith('person'))).toEqual(['search:lee@example.org', 'audit:occupancy-approve:success', 'add:lee.renter:owner:100', 'remove:lee.renter', 'audit:occupancy-approve:failure']);
    expect(audits[1].metadata['reason']).toContain('the entry was removed again');
    expect(status('a')).toBe('pending');
  });

  test('if the undo fails too, the error says the entry is still in effect', async () => {
    const m = open();
    await queued(m, 'a');
    fail['person'] = 'contact store down';
    fail['remove'] = 'disk full';
    await expect(m.approve(reviewer, 'a', { share: 100 })).rejects.toThrow('could not be removed again (disk full): it is still in effect');
    expect(status('a')).toBe('pending');
  });

  test('an entry accommodation refuses is recorded as a failure and nothing else is written', async () => {
    const m = open();
    await queued(m, 'a');
    fail['add'] = 'no accommodation 66-00001.000';
    await expect(m.approve(reviewer, 'a', { share: 100 })).rejects.toMatchObject({ name: 'LinkChangeRefusedError' });
    expect(calls.some(c => c.startsWith('person'))).toBe(false);
    expect(audits.map(a => a.result)).toEqual(['success', 'failure']);
    expect(status('a')).toBe('pending');
  });

  describe('someone with no account (#34)', () => {
    test('approve makes the account with no password, invites them, then applies the entry and details', async () => {
      const m = open();
      await queued(m, 'n', { ...ANSWERS, email: 'test.visitor@example.org', firstName: 'Test', lastName: 'Visitor' });
      accounts = [];
      const listed = await m.pending(reviewer);
      expect(listed[0].accounts).toBe('none');
      calls = []; audits = [];
      expect(await m.approve(reviewer, 'n', { newUsername: 'test.visitor', share: 100 })).toEqual({ username: 'test.visitor', created: true, invitation: { outcome: 'sent' } });
      expect(calls.filter(c => !c.startsWith('person'))).toEqual([
        'search:test.visitor@example.org', 'audit:occupancy-approve:success',
        'create:test.visitor:test.visitor@example.org:Test Visitor', 'invite:test.visitor', 'add:test.visitor:owner:100'
      ]);
      expect(audits[0].metadata).toMatchObject({ username: 'test.visitor', newAccount: true });
      expect(status('n')).toBe('approved');
    });

    test('an invitation that could not be sent is reported; the approval still completes', async () => {
      const m = open();
      await queued(m, 'n', { ...ANSWERS, email: 'test.visitor@example.org' });
      accounts = []; fail['invite'] = 'email is not working';
      expect(await m.approve(reviewer, 'n', { newUsername: 'test.visitor', share: 100 })).toMatchObject({ created: true, invitation: { outcome: 'email-unavailable', reason: 'email is not working' } });
      expect(status('n')).toBe('approved');
    });

    test.each([[undefined], [''], ['no spaces'], ['-x']])('a missing or bad username %o is refused before anything is written', async (newUsername) => {
      const m = open();
      await queued(m, 'n', { ...ANSWERS, email: 'test.visitor@example.org' });
      accounts = [];
      await expect(m.approve(reviewer, 'n', { newUsername, share: 100 })).rejects.toThrow('give a username for a new one');
      expect(calls.filter(c => !c.startsWith('search'))).toEqual([]);
    });

    test('an account that cannot be made is recorded as a failure, and nothing else is written', async () => {
      const m = open();
      await queued(m, 'n', { ...ANSWERS, email: 'test.visitor@example.org' });
      accounts = []; fail['create'] = 'username taken';
      await expect(m.approve(reviewer, 'n', { newUsername: 'test.visitor', share: 100 })).rejects.toThrow('username taken');
      expect(calls.some(c => c.startsWith('add') || c.startsWith('person'))).toBe(false);
      expect(audits.map(a => a.result)).toEqual(['success', 'failure']);
      expect(status('n')).toBe('pending');
    });
  });
});
