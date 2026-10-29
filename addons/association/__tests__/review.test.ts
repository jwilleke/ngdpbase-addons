/**
 * End to end through register() (ngdpbase#2112): a visitor sends the form, the request is filed
 * with (a stand-in for) core's reviews, and the board decides it on /executive or /reviews (the
 * stand-in's decide, which is what those pages call) or on association's own review page (its
 * routes, called directly). Accommodation, users, identity records and invitations are stand-ins
 * that refuse every write not made by the system principal, as core's executive role holds no
 * write permission. The database is core's in-memory one; nothing is written to disk.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import AssociationAddon from '../index.js';
import { OCCUPANCY_FORM_ID } from '../forms/occupancyForm.js';
import { OCCUPANCY_REVIEW } from '../managers/OccupancyManager.js';
import { fakeReviews, type FakeReviews } from './fakeReviews.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const nameOf = (c: unknown): string => (c as { username?: string }).username ?? '';
/** association-review: the board and the system principal hold it; nobody else. */
const holdsReview = (c: unknown): boolean => ['board.chair', 'system'].includes(nameOf(c));

const ANSWERS = {
  email: 'pat@example.org', firstName: 'Pat', lastName: 'Lee', existingOwner: 'No', unit: '66-00001.000',
  from: '2026-10-01', homePhone: '555-0100', working: 'No', managedBy: 'The owner'
};

type Handler = (req: unknown, res: unknown) => void;

function world(options: { seed?: boolean } = {}) {
  const managers = new Map<string, unknown>();
  const formHandlers = new Map<string, (submission: unknown, context: { engine: unknown; req: unknown }) => Promise<unknown>>();
  const routes = new Map<string, Handler>();
  const opened: Array<{ close(): void; prepare(sql: string): { all(): unknown[]; get(...p: unknown[]): unknown } }> = [];
  /** Every write, with who made it and the reason it carried. */
  const writes: Array<{ what: string; by: string; reason?: string }> = [];
  const users: Array<{ username: string; email: string }> = [];
  const write = (what: string, c: unknown): void => {
    if (nameOf(c) !== 'system') throw Object.assign(new Error(`refused: ${what}`), { name: 'AccommodationRefusedError', permission: 'accommodation-manage', decision: { permit: false } });
    writes.push({ what, by: nameOf(c), reason: (c as { reason?: string }).reason });
  };
  managers.set('AccommodationManager', { count: () => 3 });
  managers.set('ResidencyManager', {
    checkEntry: () => null,
    contactDetails: (a: Record<string, unknown>) => ({ contactPoint: [{ '@type': 'ContactPoint', contactType: 'home', telephone: String(a['homePhone']) }] }),
    changeLink: async (c: unknown, username: string, change: { link: { type: string; share?: number } }) => { write(`entry:${username}:${change.link.type}:${change.link.share}`, c); return { changed: true, at: { type: 'owner', index: 0, expected: '{}' } }; }
  });
  managers.set('UserManager', {
    searchUsers: async (q: string) => users.filter(u => u.email.includes(q) || u.username.includes(q)),
    createUser: async (u: { username: string; email: string }, c: unknown) => { write(`account:${u.username}`, c); users.push(u); return u; }
  });
  managers.set('IdentityManager', {
    getByUserIdentifier: async (_c: unknown, username: string) => (users.some(u => u.username === username) ? { '@id': `urn:uuid:${username}`, contactPoint: [] } : null),
    update: async (c: unknown, id: string) => { write(`identity:${id}`, c); },
    identityIdOf: async () => null, canAnswer: () => true,
    convertReference: async (_c: unknown, stored: string) => ({ value: stored, outcome: 'kept' })
  });
  managers.set('AuthManager', { inviteUser: async (c: unknown, username: string) => { write(`invite:${username}`, c); return { outcome: 'sent' }; } });
  managers.set('DatabaseManager', {
    isEnabled: () => true,
    openAddonDatabase: (owner: string, o: { migrations: never; ledgerTable: string }) => {
      const db = openAddonTestDatabase(owner, o, { slug: 'association', defaults });
      if (options.seed) {
        db.prepare(`INSERT INTO association_occupancy_submissions (id, received_at, submitted_by, unit, entry_type, answers) VALUES ('kept', '2026-10-20T00:00:00Z', 'anonymous', '66-00001.000', 'owner', ?)`).run(JSON.stringify(ANSWERS));
      }
      opened.push(db as never);
      return db;
    }
  });
  managers.set('PolicyDecisionPoint', {
    decide: async (c: unknown, r: { action: string }) => ({ permit: r.action === 'association-review' && holdsReview(c), applicable: true, reason: 'test' }),
    permits: async (c: unknown, action: string) => action === 'association-review' && holdsReview(c)
  });
  managers.set('AddonsManager', { registerDashboardCard: () => undefined });
  managers.set('FormsDataManager', { registerShippedForm: async () => 'saved' });
  managers.set('FormsAddon', { registerHandler: (id: string, h: never) => { formHandlers.set(id, h); } });
  const engine = {
    getManager: <T>(name: string) => managers.get(name) as T | undefined,
    registerManager: (name: string, manager: unknown) => { managers.set(name, manager); },
    app: { use: () => undefined, get: () => undefined, set: () => undefined },
    createRouter: () => ({
      get: (path: string, h: Handler) => { routes.set(`GET ${path}`, h); },
      post: (path: string, h: Handler) => { routes.set(`POST ${path}`, h); }
    }) as never,
    templateData: async () => ({})
  };
  const reviews: FakeReviews = fakeReviews(holdsReview);
  const registeredHandlers: string[] = [];
  const host = {
    ...buildAddonHost('association', defaults), reviews,
    registerReviewHandler: (id: string, h: Parameters<FakeReviews['handle']>[0]) => { registeredHandlers.push(id); reviews.handle(h); }
  };
  /** Call one of association's routes as `user`; resolves with what the page answered. */
  const call = (key: string, user: { username: string; roles: string[] }, params: Record<string, string> = {}, query: Record<string, string> = {}) =>
    new Promise<{ status: number; body?: unknown; redirect?: string; view?: string; data?: Record<string, unknown> }>((resolve) => {
      let status = 200;
      const res = {
        req: { originalUrl: '/' },
        status(code: number) { status = code; return res; },
        send(body: unknown) { resolve({ status, body }); },
        json(body: unknown) { resolve({ status, body }); },
        redirect(to: string) { resolve({ status: 302, redirect: to }); },
        render(view: string, data: Record<string, unknown>) { resolve({ status, view, data }); }
      };
      routes.get(key)!({ params, query, body: {}, userContext: { ...user, isAuthenticated: true } }, res);
    });
  return { engine, host, reviews, formHandlers, routes, opened, writes, users, registeredHandlers, call };
}

const executive = { username: 'board.chair', roles: ['executive'] };
const member = { username: 'pat.member', roles: ['member'] };

describe('occupancy forms through core\'s reviews (ngdpbase#2112)', () => {
  let w: ReturnType<typeof world>;
  afterEach(async () => { await AssociationAddon.shutdown(); for (const db of w.opened) db.close(); });

  async function started(options: { seed?: boolean } = {}): Promise<void> {
    w = world(options);
    await AssociationAddon.register(w.engine, {}, w.host as never);
  }
  async function sent(): Promise<string> {
    const req = { userContext: { username: 'anonymous', roles: ['anonymous'], isAuthenticated: false } };
    expect(await w.formHandlers.get(OCCUPANCY_FORM_ID)!({ id: 'f-1', submittedBy: 'anonymous', data: ANSWERS }, { engine: w.engine, req })).toEqual({ ok: true });
    return [...w.reviews.requests.keys()].pop()!;
  }

  test('registers its handler, and a sent form is one request for association-review', async () => {
    await started();
    expect(w.registeredHandlers).toEqual([OCCUPANCY_REVIEW]);
    const id = await sent();
    expect(w.reviews.requests.get(id)).toMatchObject({ kind: OCCUPANCY_REVIEW, decidePermission: 'association-review', filedBy: 'anonymous', status: 'open' });
  });

  test('the board approves on /executive: the account, invitation, entry and details are written by the system, naming the decider', async () => {
    await started();
    const id = await sent();
    const decided = await w.reviews.decide(executive as never, id, 'approve');
    expect(decided).toMatchObject({ status: 'approved', decidedBy: 'board.chair', outcome: expect.stringContaining('added for pat.lee, a new account, invited by email') });
    expect(w.writes.map(x => x.what)).toEqual(['account:pat.lee', 'invite:pat.lee', 'entry:pat.lee:owner:100', 'identity:urn:uuid:pat.lee']);
    for (const x of w.writes) expect(x).toMatchObject({ by: 'system', reason: `association: occupancy form f-1 (review ${id}) approved by board.chair` });
  });

  test('the board approves on association\'s review page: the same request, the same writes, then the outcome read back', async () => {
    await started();
    const id = await sent();
    expect(await w.call('POST /review/:id/approve', executive, { id: 'f-1' })).toEqual({ status: 302, redirect: '/addons/association/review?flash=approved&id=f-1' });
    expect(w.reviews.requests.get(id)).toMatchObject({ status: 'approved', decidedBy: 'board.chair' });
    expect(w.writes.every(x => x.by === 'system')).toBe(true);
    expect(w.writes).toHaveLength(4);
    const page = await w.call('GET /review', executive, {}, { flash: 'approved', id: 'f-1' });
    expect(page.view).toBe('association-review');
    expect(page.data).toMatchObject({ flash: 'approved', reason: expect.stringContaining('added for pat.lee'), submissions: [] });
  });

  test('a refused approval on the review page is a plain 403, never a 500, and changes nothing', async () => {
    await started();
    const id = await sent();
    expect(await w.call('POST /review/:id/approve', member, { id: 'f-1' })).toMatchObject({ status: 403 });
    expect(await w.call('POST /review/:id/reject', member, { id: 'f-1' })).toMatchObject({ status: 403 });
    expect(await w.call('GET /review', member)).toMatchObject({ status: 403 });
    await expect(w.reviews.decide(member as never, id, 'approve')).rejects.toMatchObject({ name: 'ReviewRefusedError' });
    expect(w.writes).toEqual([]);
    expect(w.reviews.requests.get(id)?.status).toBe('open');
  });

  test('an approval that cannot be carried out goes back to the page with core\'s reason, not in the URL', async () => {
    await started();
    const id = await sent();
    w.users.push({ username: 'one', email: 'pat@example.org' }, { username: 'two', email: 'pat@example.org' });
    expect(await w.call('POST /review/:id/approve', executive, { id: 'f-1' })).toEqual({ status: 302, redirect: '/addons/association/review?flash=failed&id=f-1' });
    expect(w.reviews.requests.get(id)).toMatchObject({ status: 'open', failure: expect.stringContaining('more than one account') });
    const page = await w.call('GET /review', executive, {}, { flash: 'failed', id: 'f-1' });
    expect(page.data).toMatchObject({ flash: 'failed', reason: expect.stringContaining('more than one account') });
    expect(w.writes).toEqual([]);
  });

  test('reject on the review page changes nothing', async () => {
    await started();
    const first = await sent();
    expect(await w.call('POST /review/:id/reject', executive, { id: 'f-1' })).toEqual({ status: 302, redirect: '/addons/association/review?flash=rejected' });
    expect(w.reviews.requests.get(first)?.status).toBe('rejected');
    expect(w.writes).toEqual([]);
  });

  test('a form kept before reviews is filed at start-up, as the system, and the board can approve it', async () => {
    await started({ seed: true });
    const [id] = [...w.reviews.requests.keys()];
    expect(w.reviews.filedAs).toEqual(['system']);
    expect(w.reviews.requests.get(id)).toMatchObject({ kind: OCCUPANCY_REVIEW, status: 'open', summary: 'Pat Lee, owner of unit 66-00001.000 from 2026-10-01' });
    await w.reviews.decide(executive as never, id, 'approve');
    expect(w.writes.map(x => x.what)).toContain('entry:pat.lee:owner:100');
    expect(w.writes.every(x => x.by === 'system')).toBe(true);
  });
});
