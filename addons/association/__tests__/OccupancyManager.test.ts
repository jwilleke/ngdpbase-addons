/**
 * OccupancyManager over core's in-memory add-on database, opened under this add-on's own
 * declaration (so a test fails where a site would refuse it), with a stand-in for core's
 * reviews (fakeReviews). Nothing is written to disk.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import type { IdentityDoors } from '../managers/OccupancyManager.js';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import OccupancyManager, { OCCUPANCY_REVIEW, type OccupancyAuditRecord, type OccupancyDb } from '../managers/OccupancyManager.js';
import { ASSOCIATION_LEDGER_TABLE, ASSOCIATION_MIGRATIONS } from '../managers/migrations.js';
import { fakeReviews, type FakeReviews } from './fakeReviews.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const host = buildAddonHost('association', defaults);
const visitor = { username: 'anonymous', roles: ['anonymous'], isAuthenticated: false, ipAddress: '192.0.2.9' } as unknown as ActorContext;
/** The system principal, as host.systemContext gives it: carrying its reason. */
const systemContext = (reason: string): ActorContext => host.systemContext(reason);
const nameOf = (c: unknown): string => (c as { username?: string }).username ?? '';

const ANSWERS = {
  email: 'lee@example.org', firstName: 'Lee', lastName: 'Renter', existingOwner: 'No', unit: '66-00001.000',
  from: '2026-10-01', to: '', homePhone: '555-0100', working: 'No', managedBy: 'The owner'
};

type TestDb = OccupancyDb & { close(): void; prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown } };
const openDb = (): TestDb => openAddonTestDatabase('association', { migrations: ASSOCIATION_MIGRATIONS as never, ledgerTable: ASSOCIATION_LEDGER_TABLE }, { slug: 'association', defaults }) as TestDb;

describe('OccupancyManager.queue (#32), filed with core\'s reviews (ngdpbase#2112)', () => {
  let db: TestDb;
  let audits: OccupancyAuditRecord[];
  let order: string[];
  let auditFails: boolean;
  let reviews: FakeReviews;

  beforeEach(() => {
    db = openDb();
    audits = []; order = []; auditFails = false;
    reviews = fakeReviews(() => true);
  });
  afterEach(() => { db.close(); });

  function open(): OccupancyManager {
    return new OccupancyManager({
      db, host, reviews, systemContext,
      decide: async () => ({ permit: true, applicable: true, reason: 'test' }),
      recordAudit: async (record) => {
        if (auditFails) throw new Error('audit sink down');
        order.push(`audit:${record.result}`);
        audits.push(record);
      },
      checkEntry: (e) => (e.parcel === '66-00001.000' ? (e.to !== 'current' && e.to < e.from ? 'ends before it starts' : null) : `no accommodation ${e.parcel}`),
      now: () => new Date('2026-10-24T12:00:00Z')
    });
  }

  const rows = () => db.prepare('SELECT * FROM association_occupancy_submissions').all() as Array<Record<string, string>>;

  test('keeps a submission as pending, recorded first, then files it as the sender for association-review', async () => {
    const m = open();
    expect(await m.queue(visitor, { id: 's-1', submittedBy: 'anonymous', formVersion: '0.1.0', data: { ...ANSWERS, emergencyEmail: 'kim@example.org' } })).toEqual({ ok: true });
    expect(order).toEqual(['audit:success']);
    const [request] = [...reviews.requests.values()];
    expect(rows()).toEqual([expect.objectContaining({ id: 's-1', unit: '66-00001.000', entry_type: 'owner', status: 'pending', submitted_by: 'anonymous', received_at: '2026-10-24T12:00:00.000Z', review_id: request.id })]);
    expect(reviews.filedAs).toEqual(['anonymous']);
    expect(request).toMatchObject({
      kind: OCCUPANCY_REVIEW, handlerId: OCCUPANCY_REVIEW, decidePermission: 'association-review',
      subject: 'Occupancy information, unit 66-00001.000', summary: 'Lee Renter, owner of unit 66-00001.000 from 2026-10-01'
    });
    // the answers, labelled as the form asks them; a label asked twice is told apart by its section
    expect(request.details).toMatchObject({ Unit: '66-00001.000', Entry: 'owner', Email: 'lee@example.org', 'First name': 'Lee', 'Home phone': '555-0100', 'Emergency contact: Email': 'kim@example.org', 'Share on approval': expect.stringContaining('100%') });
    expect(audits[0]).toMatchObject({ action: 'occupancy-submit-owner', resource: '66-00001.000', ipAddress: '192.0.2.9',
      metadata: { submissionId: 's-1', entryType: 'owner', fields: ['email', 'emergencyEmail', 'existingOwner', 'firstName', 'from', 'homePhone', 'lastName', 'managedBy', 'unit', 'working'] } });
    // the record names the questions answered, never the answers
    expect(JSON.stringify(audits[0])).not.toMatch(/lee@example|Renter|555-0100/);
    expect(m.pendingCount()).toBe(1);
  });

  test.each([
    [{ existingOwner: 'Maybe' }, { fields: { existingOwner: 'Choose Yes or No' } }],
    [{ email: ' ' }, { fields: { email: 'An email is required' } }],
    [{ unit: '99-99999.000' }, { error: 'Not accepted: no accommodation 99-99999.000' }],
    [{ to: '2026-09-01' }, { error: 'Not accepted: ends before it starts' }]
  ])('refuses %o, keeping, recording and filing nothing', async (change, refusal) => {
    const m = open();
    expect(await m.queue(visitor, { id: 's-2', submittedBy: 'anonymous', data: { ...ANSWERS, ...change } })).toMatchObject({ ok: false, ...refusal });
    expect(order).toEqual([]);
    expect(rows()).toEqual([]);
    expect(reviews.requests.size).toBe(0);
  });

  test('a record that cannot be written refuses the submission: nothing is kept or filed', async () => {
    const m = open();
    auditFails = true;
    await expect(m.queue(visitor, { id: 's-3', submittedBy: 'anonymous', data: ANSWERS })).rejects.toThrow('audit sink down');
    expect(rows()).toEqual([]);
    expect(reviews.requests.size).toBe(0);
  });

  test('a row that cannot be kept is recorded as a failure and thrown; nothing more is filed', async () => {
    const m = open();
    await m.queue(visitor, { id: 'dup', submittedBy: 'anonymous', data: ANSWERS });
    order = [];
    await expect(m.queue(visitor, { id: 'dup', submittedBy: 'anonymous', data: ANSWERS })).rejects.toThrow();
    expect(order).toEqual(['audit:success', 'audit:failure']);
    expect(reviews.requests.size).toBe(1);
    expect(m.pendingCount()).toBe(1);
  });

  test('when core cannot keep requests, the sender is told and nothing is kept', async () => {
    const m = open();
    reviews.unavailable = true;
    expect(await m.queue(visitor, { id: 's-4', submittedBy: 'anonymous', data: ANSWERS })).toMatchObject({ ok: false, error: expect.stringContaining('nothing was kept') });
    expect(rows()).toEqual([]);
    expect(order).toEqual(['audit:success', 'audit:failure']);
    expect(audits[1].metadata['reason']).toBe('not filed for review: ReviewsUnavailableError');
  });
});

describe('deciding an occupancy request (ngdpbase#2112)', () => {
  let db: TestDb;
  let audits: OccupancyAuditRecord[];
  let calls: string[];
  let fail: Record<string, string>;
  let accounts: Array<{ username: string; email?: string }>;
  let taken: string[];
  let reviews: FakeReviews;
  /** The board: core's executive role, holding association-review and nothing that writes. */
  const executive = { username: 'board.chair', roles: ['executive'], isAuthenticated: true, ipAddress: '192.0.2.5' } as unknown as ActorContext;
  const stranger = { username: 'nobody', roles: ['admin'], isAuthenticated: true } as unknown as ActorContext;
  /** association-review, asked of the caller: the board holds it, and the system principal acts for the board. */
  const holdsReview = (c: unknown): boolean => ['board.chair', 'system'].includes(nameOf(c));

  beforeEach(() => {
    db = openDb();
    audits = []; calls = []; fail = {}; taken = [];
    accounts = [{ username: 'lee.renter', email: 'Lee@Example.org' }];
    reviews = fakeReviews(holdsReview);
  });
  afterEach(() => { db.close(); });

  /** Every write refuses anyone but the system principal, as the executive role holds no write permission. */
  const writer = (c: unknown, what: string): void => {
    if (nameOf(c) !== 'system') throw Object.assign(new Error(`refused: ${what}`), { name: 'AccommodationRefusedError' });
  };

  function open(): OccupancyManager {
    const m = new OccupancyManager({
      db, host, reviews, systemContext,
      decide: async (c) => ({ permit: holdsReview(c), applicable: true, reason: 'test' }),
      recordAudit: async (record) => { calls.push(`audit:${record.action}:${record.result}`); audits.push(record); },
      checkEntry: () => null,
      approval: {
        searchUsers: async (c, email) => { calls.push(`search:${nameOf(c)}:${email}`); return accounts; },
        usernameTaken: async (_c, username) => taken.includes(username),
        addEntry: async (c, username, entry) => {
          writer(c, 'accommodation-manage');
          calls.push(`add:${username}:${entry.type}:${entry.share ?? ''}`);
          if (fail['add']) throw Object.assign(new Error(fail['add']), { name: 'LinkChangeRefusedError' });
          return { type: entry.type, index: 0, expected: '{}' };
        },
        removeEntry: async (c, username) => { writer(c, 'accommodation-manage'); calls.push(`remove:${username}`); if (fail['remove']) throw new Error(fail['remove']); },
        findPerson: async (_c, username) => (accounts.some(a => a.username === username) && username !== 'lee.renter' ? { id: `urn:uuid:${username}`, contactPoint: [] }
          : username === 'lee.renter' ? { id: 'urn:uuid:lee', contactPoint: [{ '@type': 'ContactPoint', contactType: 'home', telephone: 'old' }, { '@type': 'ContactPoint', contactType: 'fax', telephone: 'keep' }] } : null),
        updatePerson: async (c, id, patch) => { writer(c, 'identity-manage'); calls.push(`person:${id}:${JSON.stringify(patch)}`); if (fail['person']) throw new Error(fail['person']); },
        createUser: async (c, user) => {
          writer(c, 'user-create');
          calls.push(`create:${user.username}:${user.email}:${user.displayName}`);
          if (fail['create']) throw new Error(fail['create']);
          accounts = [{ username: user.username, email: user.email }];
          return { username: user.username };
        },
        inviteUser: async (c, username) => { writer(c, 'user-create'); calls.push(`invite:${username}`); return fail['invite'] ? { outcome: 'email-unavailable', reason: fail['invite'] } : { outcome: 'sent' }; },
        // a stand-in for accommodation's mapping, which accommodation's own tests cover
        contactDetails: (a) => ({ contactPoint: [
          ...(a['homeMailingAddress'] ? [{ '@type': 'PostalAddress' as const, contactType: 'mailing', streetAddress: String(a['homeMailingAddress']) }] : []),
          ...(a['homePhone'] ? [{ '@type': 'ContactPoint' as const, contactType: 'home', telephone: String(a['homePhone']) }] : []),
          ...(a['emergencyName'] ? [{ '@type': 'ContactPoint' as const, contactType: 'emergency', name: String(a['emergencyName']), telephone: String(a['emergencyPhone']) }] : [])
        ] })
      }
    });
    // core calls the handler association registers (index.ts) with the decider's context
    reviews.handle((request, ctx) => m.applyReview(ctx, request));
    return m;
  }
  const status = (id: string) => (db.prepare('SELECT status FROM association_occupancy_submissions WHERE id = ?').get(id) as { status: string }).status;
  const reviewOf = (id: string) => (db.prepare('SELECT review_id FROM association_occupancy_submissions WHERE id = ?').get(id) as { review_id: string }).review_id;
  async function queued(m: OccupancyManager, id: string, data: Record<string, unknown> = ANSWERS): Promise<string> {
    await m.queue(visitor, { id, submittedBy: 'anonymous', data });
    calls = []; audits = [];
    return reviewOf(id);
  }
  const writes = () => calls.filter(c => /^(add|remove|person|create|invite)/.test(c));

  test('an executive-only decider approves on /reviews or /executive: every write is the system\'s, naming the decider', async () => {
    const m = open();
    const request = await queued(m, 'a', { ...ANSWERS, homeMailingAddress: 'PO Box 1', emergencyName: 'Kim', emergencyPhone: '555-0199', agentName: '' });
    const decided = await reviews.decide(executive, request, 'approve');
    expect(decided).toMatchObject({ status: 'approved', decidedBy: 'board.chair', outcome: 'Owner (100%) of unit 66-00001.000 from 2026-10-01: added for lee.renter, and the details saved.' });
    expect(calls.slice(0, 3)).toEqual(['search:system:lee@example.org', 'audit:occupancy-approve:success', 'add:lee.renter:owner:100']);
    const patch = JSON.parse(calls[3].replace('person:urn:uuid:lee:', '')) as { contactPoint: Array<Record<string, string>> };
    expect(patch.contactPoint).toEqual([
      { '@type': 'ContactPoint', contactType: 'fax', telephone: 'keep' }, // a kind this form does not write is kept
      { '@type': 'PostalAddress', contactType: 'mailing', streetAddress: 'PO Box 1' },
      { '@type': 'ContactPoint', contactType: 'home', telephone: '555-0100' }, // replaces the old home phone
      { '@type': 'ContactPoint', contactType: 'emergency', name: 'Kim', telephone: '555-0199' }
    ]);
    expect(status('a')).toBe('approved');
    // the record is the system's, with the reason naming the form, the request and the decider
    expect(audits[0]).toMatchObject({ user: 'system', action: 'occupancy-approve', result: 'success',
      metadata: { submissionId: 'a', reviewId: request, decidedBy: 'board.chair', reason: `association: occupancy form a (review ${request}) approved by board.chair` } });
    expect(JSON.stringify(audits)).not.toMatch(/555-0100|PO Box/);
  });

  test('association\'s own review page decides through the same request, with the same outcome', async () => {
    const m = open();
    const request = await queued(m, 'a');
    expect(await m.decide(executive, 'a', 'approve')).toEqual({ outcome: expect.stringContaining('added for lee.renter') });
    expect(reviews.requests.get(request)).toMatchObject({ status: 'approved', decidedBy: 'board.chair' });
    expect(writes()).toEqual(['add:lee.renter:owner:100', expect.stringMatching(/^person:urn:uuid:lee:/)]);
    expect(await m.decisionOf(executive, 'a')).toEqual({ outcome: expect.stringContaining('added for lee.renter'), failure: null });
    await expect(m.decide(executive, 'a', 'approve')).rejects.toThrow('already approved');
  });

  test('a decider without association-review changes nothing, wherever they decide', async () => {
    const m = open();
    const request = await queued(m, 'a');
    await expect(reviews.decide(stranger, request, 'approve')).rejects.toMatchObject({ name: 'ReviewRefusedError', permission: 'association-review' });
    // a role named admin does not stand in for the permission
    await expect(m.decide(stranger, 'a', 'approve')).rejects.toMatchObject({ name: 'OccupancyRefusedError', permission: 'association-review' });
    await expect(m.applyReview(stranger, { id: request })).rejects.toMatchObject({ name: 'OccupancyRefusedError' });
    await expect(m.pending(stranger)).rejects.toMatchObject({ name: 'OccupancyRefusedError' });
    expect(calls).toEqual([]);
    expect(status('a')).toBe('pending');
    expect(reviews.requests.get(request)?.status).toBe('open');
  });

  test('reject on the review page: nothing is applied, core records it, the submission leaves the list', async () => {
    const m = open();
    const request = await queued(m, 'a');
    expect(await m.decide(executive, 'a', 'reject')).toEqual({ outcome: 'rejected' });
    expect(status('a')).toBe('rejected');
    expect(reviews.requests.get(request)).toMatchObject({ status: 'rejected', decidedBy: 'board.chair' });
    expect(calls).toEqual([]);
    expect(await m.pending(executive)).toEqual([]);
    await expect(m.decide(executive, 'a', 'reject')).rejects.toThrow('already rejected');
  });

  test('reject on /reviews or /executive: nothing is applied, and the review page marks it rejected when it next lists', async () => {
    const m = open();
    const request = await queued(m, 'a');
    await queued(m, 'b');
    expect(await m.waitingCount(executive)).toBe(2);
    await reviews.decide(executive, request, 'reject');
    expect(await m.waitingCount(executive)).toBe(1);
    expect((await m.pending(executive)).map(s => s.id)).toEqual(['b']);
    expect(status('a')).toBe('rejected');
    expect(writes()).toEqual([]);
  });

  test('pending lists what waits, oldest first, with the share approval gives and whether an account has the email', async () => {
    const m = open();
    await queued(m, 'a');
    expect((await m.pending(executive)).map(s => [s.id, s.unit, s.entryType, s.answers['email'], s.share, s.accounts])).toEqual([['a', '66-00001.000', 'owner', 'lee@example.org', 100, 'one']]);
  });

  test.each([
    [[{ username: 'a', email: 'lee@example.org' }, { username: 'b', email: 'LEE@example.org' }], 'more than one account']
  ])('approval never guesses the account: %o', async (found, message) => {
    const m = open();
    const request = await queued(m, 'a');
    accounts = found;
    await expect(reviews.decide(executive, request, 'approve')).rejects.toMatchObject({ name: 'ReviewHandlerFailedError', message: expect.stringContaining(message) });
    expect(writes()).toEqual([]);
    expect(status('a')).toBe('pending');
    // the request stays open with the reason, shown to the decider
    expect(reviews.requests.get(request)).toMatchObject({ status: 'open', failure: expect.stringContaining(message) });
    expect(await m.decisionOf(executive, 'a')).toMatchObject({ failure: expect.stringContaining(message) });
  });

  test('details that cannot be written: the entry is removed again, the request stays open, the failure is recorded', async () => {
    const m = open();
    const request = await queued(m, 'a');
    fail['person'] = 'contact store down';
    await expect(reviews.decide(executive, request, 'approve')).rejects.toThrow('contact store down');
    expect(calls.filter(c => !c.startsWith('person'))).toEqual(['search:system:lee@example.org', 'audit:occupancy-approve:success', 'add:lee.renter:owner:100', 'remove:lee.renter', 'audit:occupancy-approve:failure']);
    expect(audits[1].metadata['reason']).toContain('the entry was removed again');
    expect(status('a')).toBe('pending');
    expect(reviews.requests.get(request)?.status).toBe('open');
  });

  test('if the undo fails too, the error says the entry is still in effect', async () => {
    const m = open();
    const request = await queued(m, 'a');
    fail['person'] = 'contact store down';
    fail['remove'] = 'disk full';
    await expect(reviews.decide(executive, request, 'approve')).rejects.toThrow('could not be removed again (disk full): it is still in effect');
    expect(status('a')).toBe('pending');
  });

  test('an entry accommodation refuses is recorded as a failure and nothing else is written', async () => {
    const m = open();
    const request = await queued(m, 'a');
    fail['add'] = 'no accommodation 66-00001.000';
    await expect(reviews.decide(executive, request, 'approve')).rejects.toMatchObject({ name: 'ReviewHandlerFailedError' });
    expect(calls.some(c => c.startsWith('person'))).toBe(false);
    expect(audits.map(a => a.result)).toEqual(['success', 'failure']);
    expect(status('a')).toBe('pending');
  });

  describe('someone with no account (#34)', () => {
    const NEW = { ...ANSWERS, email: 'test.visitor@example.org', firstName: 'Test', lastName: 'Visitor' };

    test('approval makes the account as the system, with a username from the name, invites them, then applies the entry and details', async () => {
      const m = open();
      const request = await queued(m, 'n', NEW);
      accounts = [];
      expect((await m.pending(executive))[0].accounts).toBe('none');
      calls = []; audits = [];
      const decided = await reviews.decide(executive, request, 'approve');
      expect(decided.outcome).toBe('Owner (100%) of unit 66-00001.000 from 2026-10-01: added for test.visitor, a new account, invited by email; the details saved.');
      expect(calls.filter(c => !c.startsWith('person'))).toEqual([
        'search:system:test.visitor@example.org', 'audit:occupancy-approve:success',
        'create:test.visitor:test.visitor@example.org:Test Visitor', 'invite:test.visitor', 'add:test.visitor:owner:100'
      ]);
      // no identity yet when the first record is written: the name stands in `owner`
      expect(audits[0].metadata).toMatchObject({ owner: 'test.visitor', ownerUser: 'test.visitor', newAccount: true, decidedBy: 'board.chair' });
      expect(status('n')).toBe('approved');
    });

    test('a username already taken gets a short suffix from the request', async () => {
      const m = open();
      const request = await queued(m, 'n', NEW);
      accounts = []; taken = ['test.visitor'];
      await reviews.decide(executive, request, 'approve');
      expect(calls).toContain(`create:test.visitor.${request.slice(0, 4)}:test.visitor@example.org:Test Visitor`);
    });

    test('with both taken, nothing is written and the decider is told what to do', async () => {
      const m = open();
      const request = await queued(m, 'n', NEW);
      accounts = []; taken = ['test.visitor', `test.visitor.${request.slice(0, 4)}`];
      await expect(reviews.decide(executive, request, 'approve')).rejects.toThrow('the username test.visitor is taken; make the account on User Management');
      expect(writes()).toEqual([]);
      expect(audits).toEqual([]);
    });

    test('a name that makes no username falls back to the email', async () => {
      const m = open();
      const request = await queued(m, 'n', { ...NEW, firstName: '李', lastName: '雷' });
      accounts = [];
      await reviews.decide(executive, request, 'approve');
      expect(calls).toContain('create:test.visitor:test.visitor@example.org:李 雷');
    });

    test('an invitation that could not be sent is reported; the approval still completes', async () => {
      const m = open();
      const request = await queued(m, 'n', NEW);
      accounts = []; fail['invite'] = 'email is not working';
      expect((await reviews.decide(executive, request, 'approve')).outcome).toContain('the invitation was not sent (email is not working)');
      expect(status('n')).toBe('approved');
    });

    test('an account that cannot be made is recorded as a failure, and nothing else is written', async () => {
      const m = open();
      const request = await queued(m, 'n', NEW);
      accounts = []; fail['create'] = 'username taken';
      await expect(reviews.decide(executive, request, 'approve')).rejects.toThrow('username taken');
      expect(calls.some(c => c.startsWith('add') || c.startsWith('person'))).toBe(false);
      expect(audits.map(a => a.result)).toEqual(['success', 'failure']);
      expect(status('n')).toBe('pending');
    });
  });

  describe('submissions kept before reviews', () => {
    const insert = (id: string, status = 'pending') => db.prepare(`INSERT INTO association_occupancy_submissions (id, received_at, submitted_by, submitter_name, unit, entry_type, answers, status)
      VALUES (?, ?, 'anonymous', '', '66-00001.000', 'owner', ?, ?)`).run(id, `2026-10-2${id.length}T00:00:00Z`, JSON.stringify(ANSWERS), status);

    test('are filed once, as the system, and then decided like any other', async () => {
      insert('old'); insert('done', 'approved');
      const m = open();
      expect(await m.waitingCount(executive)).toBe(1); // not filed yet, still counted
      expect(await m.fileWaiting()).toEqual({ filed: 1, postponed: false });
      expect(await m.fileWaiting()).toEqual({ filed: 0, postponed: false });
      expect(reviews.filedAs).toEqual(['system']);
      expect(await m.waitingCount(executive)).toBe(1);
      await reviews.decide(executive, reviewOf('old'), 'approve');
      expect(status('old')).toBe('approved');
      expect(writes()).toEqual(['add:lee.renter:owner:100', expect.stringMatching(/^person:/)]);
    });

    test('one not filed yet is filed when the review page decides it', async () => {
      insert('old');
      const m = open();
      await m.decide(executive, 'old', 'reject');
      expect(status('old')).toBe('rejected');
      expect(reviews.requests.get(reviewOf('old'))?.status).toBe('rejected');
    });

    test('when core cannot keep requests, filing is postponed and they stay pending', async () => {
      insert('old');
      reviews.unavailable = true;
      expect(await open().fileWaiting()).toEqual({ filed: 0, postponed: true });
      expect(reviewOf('old')).toBeNull();
      expect(status('old')).toBe('pending');
    });
  });
});

describe('identity @ids (#2042)', () => {
  // These share the review describe's wiring through a small copy, so each rule is tested alone.
  let db: TestDb;
  let audits: OccupancyAuditRecord[];
  let reviews: FakeReviews;
  let known: Record<string, string>;
  let answers: boolean;
  let lookups: string[];
  const reviewer = { username: 'board.member', roles: [], isAuthenticated: true } as unknown as ActorContext;
  const system = { username: 'system', roles: [], isAuthenticated: true } as unknown as ActorContext;

  beforeEach(() => {
    db = openDb();
    reviews = fakeReviews(() => true);
    audits = []; lookups = []; known = { 'lee.renter': 'urn:uuid:lee' }; answers = true;
  });
  afterEach(() => { db.close(); });

  const identities: IdentityDoors = {
    identityIdOf: async (_c, username) => { lookups.push(username); return answers ? known[username] ?? null : null; },
    canAnswer: () => answers,
    convertReference: async (_c, stored) => {
      if (!stored || stored.startsWith('urn:')) return { value: stored, outcome: 'kept' };
      if (stored.startsWith('orphan:')) return { value: stored, outcome: 'orphan' };
      if (stored === 'anonymous') return { value: stored, outcome: 'kept' };
      if (!answers) throw new Error('identity store down');
      return known[stored] ? { value: known[stored], outcome: 'converted' } : { value: `orphan:${stored}`, outcome: 'orphaned' };
    }
  };
  function open(withIdentities = true): OccupancyManager {
    const m = new OccupancyManager({
      db, host, reviews, identities: withIdentities ? identities : undefined, systemContext: () => system,
      decide: async () => ({ permit: true, applicable: true, reason: 'test' }),
      recordAudit: async (record) => { audits.push(record); },
      checkEntry: () => null,
      approval: {
        searchUsers: async () => [{ username: 'lee.renter', email: 'lee@example.org' }],
        usernameTaken: async () => false,
        addEntry: async () => ({ type: 'owner', index: 0, expected: '{}' }),
        removeEntry: async () => undefined,
        findPerson: async (_c, username) => (username === 'lee.renter' ? { id: 'urn:uuid:lee', contactPoint: [] } : null),
        updatePerson: async () => undefined,
        createUser: async (_c, u) => ({ username: u.username }),
        inviteUser: async () => ({ outcome: 'sent' }),
        contactDetails: () => ({ contactPoint: [] })
      }
    });
    reviews.handle((request, ctx) => m.applyReview(ctx, request));
    return m;
  }
  const stored = () => db.prepare('SELECT id, submitted_by, submitter_name FROM association_occupancy_submissions ORDER BY id').all() as Array<Record<string, string>>;
  const insert = (id: string, by: string) => db.prepare(`INSERT INTO association_occupancy_submissions (id, received_at, submitted_by, unit, entry_type, answers) VALUES (?, 't', ?, 'u', 'owner', '{}')`).run(id, by);

  test('a new submission stores the submitter by @id and keeps the name for showing', async () => {
    const m = open();
    await m.queue(reviewer, { id: 'a', submittedBy: 'lee.renter', data: ANSWERS });
    expect(stored()).toEqual([{ id: 'a', submitted_by: 'urn:uuid:lee', submitter_name: 'lee.renter' }]);
    expect((await m.pending(reviewer))[0]).toMatchObject({ submittedBy: 'urn:uuid:lee', submitterName: 'lee.renter' });
  });

  test('an @id from the forms add-on is kept, with the name it sent', async () => {
    await open().queue(reviewer, { id: 'a', submittedBy: 'urn:uuid:lee', submitterName: 'lee.renter', data: ANSWERS });
    expect(stored()).toEqual([{ id: 'a', submitted_by: 'urn:uuid:lee', submitter_name: 'lee.renter' }]);
    expect(lookups).toEqual([]);
  });

  test.each([['anonymous'], ['no.account'], ['orphan:gone']])('%s is stored as given (no account, anonymous or an orphan)', async (by) => {
    await open().queue(reviewer, { id: 'a', submittedBy: by, data: ANSWERS });
    expect(stored()[0]).toMatchObject({ submitted_by: by, submitter_name: by });
  });

  test('an identity store that cannot answer still keeps the submission, with the name', async () => {
    answers = false;
    await open().queue(reviewer, { id: 'a', submittedBy: 'lee.renter', data: ANSWERS });
    expect(stored()[0]).toMatchObject({ submitted_by: 'lee.renter' });
  });

  test('approval audits owner as the @id and ownerUser as the username', async () => {
    const m = open();
    await m.queue(reviewer, { id: 'a', submittedBy: 'anonymous', data: ANSWERS });
    await m.decide(reviewer, 'a', 'approve');
    expect(audits.filter(a => a.action === 'occupancy-approve').map(a => a.metadata)).toEqual([
      expect.objectContaining({ owner: 'urn:uuid:lee', ownerUser: 'lee.renter' })
    ]);
  });

  test('approval still works with no identity door: the read of the record gives the @id', async () => {
    const m = open(false);
    await m.queue(reviewer, { id: 'a', submittedBy: 'anonymous', data: ANSWERS });
    await m.decide(reviewer, 'a', 'approve');
    expect(audits.find(a => a.action === 'occupancy-approve')!.metadata).toMatchObject({ owner: 'urn:uuid:lee', ownerUser: 'lee.renter' });
  });

  describe('start-up conversion', () => {
    test('usernames become @ids, no account becomes orphan:<name>, the rest is left; the name is kept', async () => {
      insert('1', 'lee.renter'); insert('2', 'gone.user'); insert('3', 'anonymous'); insert('4', 'urn:uuid:other'); insert('5', 'orphan:old');
      expect(await open().convertSubmitters()).toEqual({ converted: 1, orphans: 2, postponed: false });
      expect(stored()).toEqual([
        { id: '1', submitted_by: 'urn:uuid:lee', submitter_name: 'lee.renter' },
        { id: '2', submitted_by: 'orphan:gone.user', submitter_name: 'gone.user' },
        { id: '3', submitted_by: 'anonymous', submitter_name: '' },
        { id: '4', submitted_by: 'urn:uuid:other', submitter_name: '' },
        { id: '5', submitted_by: 'orphan:old', submitter_name: '' }
      ]);
    });

    test('a second start writes nothing', async () => {
      insert('1', 'lee.renter'); insert('2', 'gone.user');
      await open().convertSubmitters();
      const before = JSON.stringify(stored());
      expect(await open().convertSubmitters()).toEqual({ converted: 0, orphans: 1, postponed: false });
      expect(JSON.stringify(stored())).toBe(before);
    });

    test('a later account with an orphan\'s name does not take the submission over', async () => {
      insert('2', 'gone.user');
      await open().convertSubmitters();
      known['gone.user'] = 'urn:uuid:new';
      await open().convertSubmitters();
      expect(stored()[0]).toMatchObject({ submitted_by: 'orphan:gone.user' });
    });

    test('an identity store that cannot answer postpones the whole pass and writes nothing', async () => {
      insert('1', 'lee.renter'); insert('2', 'gone.user');
      answers = false;
      expect(await open().convertSubmitters()).toEqual({ converted: 0, orphans: 0, postponed: true });
      expect(stored().map(r => r.submitted_by)).toEqual(['lee.renter', 'gone.user']);
    });

    test('a store that fails midway leaves the rest for the next start', async () => {
      insert('1', 'lee.renter'); insert('2', 'gone.user');
      const m = open();
      let n = 0;
      const real = identities.convertReference;
      identities.convertReference = async (c, v) => { if (++n === 2) throw new Error('died'); return real(c, v); };
      try { expect(await m.convertSubmitters()).toMatchObject({ postponed: true, converted: 1 }); } finally { identities.convertReference = real; }
      expect(stored().map(r => r.submitted_by)).toEqual(['urn:uuid:lee', 'gone.user']);
    });

    test('with no identity store at all nothing happens', async () => {
      insert('1', 'lee.renter');
      expect(await open(false).convertSubmitters()).toEqual({ converted: 0, orphans: 0, postponed: false });
      expect(stored()[0].submitted_by).toBe('lee.renter');
    });
  });
});
