/**
 * ResidencyManager: owners and occupants from the dated links on user records
 * (#21), read as the caller. No files are written.
 */
import { describe, expect, test } from 'vitest';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import ResidencyManager, { type RoleDoor } from '../managers/ResidencyManager.js';
import type { Accommodation } from '../providers/AccommodationProvider.js';
import { SAMPLE_ACCOMMODATIONS, SAMPLE_USERS, TEST_TODAY } from './fixtures.js';

const ctx = { username: 'treasurer', roles: [], isAuthenticated: true } as unknown as ActorContext;

describe('ResidencyManager', () => {
  let asked: unknown[] = [];

  function open(units: Accommodation[] = SAMPLE_ACCOMMODATIONS): ResidencyManager {
    asked = [];
    const byId = new Map(units.map(u => [u.id, u]));
    return new ResidencyManager({
      users: async (c) => { asked.push(c); return SAMPLE_USERS; },
      accommodation: (id) => byId.get(id),
      today: () => TEST_TODAY,
      // the caller here holds accommodation-billing-read; 'nobody' does not
      decide: async (c, { action }) => ({ permit: action === 'accommodation-billing-read' && (c as { username?: string }).username !== 'nobody', applicable: true, reason: 'test' }),
      systemContext: (reason) => ({ username: 'system', roles: [], isAuthenticated: true, reason }) as unknown as ActorContext
    });
  }

  test('owners are the users with a current owner link', async () => {
    const m = open();
    expect(await m.owners(ctx, '66-00001.000')).toEqual([
      { username: 'pat.example', name: 'Pat Example', email: 'pat@example.org' },
      { username: 'sam.example', name: 'Sam Example', email: null }
    ]); // old.owner's link ended in 2015; broken.links is malformed and left out
    // sam.example owns two units; no displayName falls back to the username
    expect((await m.owners(ctx, '66-00002.000')).map(o => o.name)).toEqual(['kim.both', 'Sam Example']);
    expect(await m.owners(ctx, '66-00003.000')).toEqual([]);
    expect(asked.every(c => c === ctx)).toBe(true); // users are read as the caller
  });

  test('owners on a past date: who owned it then', async () => {
    const m = open([{ id: '66-00001.000' }]);
    expect((await m.owners(ctx, '66-00001.000', { on: '2012-01-01' })).map(o => o.username)).toEqual(['old.owner']);
    expect((await m.owners(ctx, '66-00001.000', { on: '2015-05-31' })).map(o => o.username)).toEqual(['old.owner']); // the last day counts
    expect((await m.owners(ctx, '66-00001.000', { on: '2015-06-01' })).map(o => o.username)).toEqual(['pat.example', 'sam.example']);
    await expect(m.owners(ctx, '66-00001.000', { on: '2015-6-1' })).rejects.toThrow('not a date');
  });

  test('occupants are the users with a current occupant link, never billed', async () => {
    const m = open();
    expect((await m.occupants(ctx, '66-00001.000')).map(o => o.username)).toEqual(['lee.renter']); // moving.in starts next month
    expect((await m.occupants(ctx, '66-00002.000')).map(o => o.username)).toEqual(['kim.both']);
    expect((await m.occupants(ctx, '66-00001.000', { on: '2026-11-01' })).map(o => o.username)).toEqual(['lee.renter', 'moving.in']);
  });

  test('history: everyone the unit has had, oldest first, with dates', async () => {
    const m = open();
    expect((await m.history(ctx, '66-00001.000')).map(h => [h.username, h.type, h.from, h.to])).toEqual([
      ['old.owner', 'owner', '2008-01-10', '2015-05-31'],
      ['pat.example', 'owner', '2015-06-01', 'current'],
      ['sam.example', 'owner', '2015-06-01', 'current'],
      ['lee.renter', 'occupant', '2023-02-01', 'current'],
      ['moving.in', 'occupant', '2026-11-01', 'current']
    ]);
  });

  test('a malformed link is reported, never guessed', async () => {
    const m = open();
    expect(await m.linkProblems(ctx)).toEqual(['broken.links: ownership[0].ownedThrough must be a date YYYY-MM-DD or "current"']);
  });

  test("owners' shares that do not add up to 100 are reported, on each date the owners change", async () => {
    const users = [
      { username: 'a', ownership: [{ typeOfGood: 'p1', ownedFrom: '2020-01-01', ownedThrough: 'current', share: 60 }] },
      { username: 'b', ownership: [{ typeOfGood: 'p1', ownedFrom: '2020-01-01', ownedThrough: '2021-12-31', share: 40 }] },
      { username: 'c', ownership: [{ typeOfGood: 'p1', ownedFrom: '2022-01-01', ownedThrough: 'current', share: 30 }] }
    ];
    const m = new ResidencyManager({ users: async () => users, accommodation: () => undefined, today: () => TEST_TODAY });
    expect(await m.linkProblems(ctx)).toEqual(["unit p1: owners' shares on 2022-01-01 add up to 90%, not 100% (a 60%, c 30%)"]);
  });

  test('withoutOwner: the units with no owner on the date, live from the links', async () => {
    const m = open();
    const ids = SAMPLE_ACCOMMODATIONS.map(a => a.id);
    expect(await m.withoutOwner(ctx, ids)).toEqual(['66-00003.000']);
    expect(await m.withoutOwner(ctx, ids, { on: '2009-01-01' })).toEqual(['66-00002.000', '66-00003.000']);
    expect(asked.every(c => c === ctx)).toBe(true);
    await expect(m.withoutOwner(ctx, ids, { on: 'soon' })).rejects.toThrow('not a date');
  });

  test('billing: one invoice per billing party, as kept on the unit', async () => {
    const m = open();
    expect(await m.billing(ctx, '66-00001.000')).toEqual([
      { to: [{ username: 'pat.example', name: 'Pat Example', email: 'pat@example.org' }], name: 'Pat Example',
        address: { streetAddress: '101 Sample Dr', addressLocality: 'Mount Vernon', addressRegion: 'OH', postalCode: '43050' }, share: 60 },
      { to: [{ username: 'sam.example', name: 'Sam Example', email: null }], name: 'Sam Example',
        address: { streetAddress: '9 Elsewhere Ln', addressLocality: 'Columbus', addressRegion: 'OH', postalCode: '43215' }, share: 40 }
    ]);
  });

  test('billing is a door: decided with the caller, then read as the system naming them; refused without the permission', async () => {
    const m = open();
    await m.billing(ctx, '66-00001.000');
    expect(asked.length > 0 && asked.every(c => (c as { reason?: string }).reason === 'accommodation: billing parties of unit 66-00001.000, for treasurer')).toBe(true);
    asked = [];
    const job = { username: 'nobody', roles: [], isAuthenticated: false } as unknown as ActorContext;
    await expect(m.billing(job, '66-00001.000')).rejects.toMatchObject({ name: 'AccommodationRefusedError', permission: 'accommodation-billing-read' });
    expect(asked).toEqual([]); // nobody is read before the door says yes
  });

  test('billing with no parties kept: every current owner, one invoice, at the unit address, 100%', async () => {
    const m = open();
    const [party, ...rest] = await m.billing(ctx, '66-00002.000');
    expect(rest).toEqual([]);
    expect(party).toMatchObject({ name: 'kim.both and Sam Example', share: 100, address: { streetAddress: '103 Sample Dr' } });
  });

  test('joint owners at one address: one invoice naming both', async () => {
    const m = open([{ id: '66-00002.000', address: { streetAddress: '103 Sample Dr' },
      billing: [{ to: ['kim.both', 'sam.example'], address: { streetAddress: '103 Sample Dr' }, share: 100 }] }]);
    const parties = await m.billing(ctx, '66-00002.000');
    expect(parties.map(p => [p.name, p.share])).toEqual([['kim.both and Sam Example', 100]]);
  });

  test.each([
    [[{ to: ['pat.example'], address: { streetAddress: 'A' }, share: 60 }], 'add up to 60%, not 100%'],
    [[{ to: ['pat.example'], address: { streetAddress: 'A' }, share: 70 }, { to: ['sam.example'], address: { streetAddress: 'B' }, share: 40 }], 'add up to 110%'],
    [[{ to: ['old.owner'], address: { streetAddress: 'A' }, share: 100 }], 'names old.owner, who is not a current owner'],
    [[{ to: [], address: { streetAddress: 'A' }, share: 100 }], 'must name at least one owner'],
    [[{ to: ['pat.example'], address: {}, share: 100 }], 'must have a streetAddress'],
    [[], 'must be a list of billing parties']
  ])('billing refuses rather than bill wrongly: %o', async (billing, message) => {
    const m = open([{ id: '66-00001.000', billing }]);
    await expect(m.billing(ctx, '66-00001.000')).rejects.toThrow(message);
  });

  test('billing on a past date bills who owned it then', async () => {
    const m = open([{ id: '66-00001.000', address: { streetAddress: '101 Sample Dr' } }]);
    expect((await m.billing(ctx, '66-00001.000', { on: '2012-01-01' })).map(p => p.name)).toEqual(['Old Owner']);
  });

  test('billing refuses a unit with no owner, or no address to bill', async () => {
    const m = open([{ id: '66-00003.000' }, { id: '66-00001.000' }]);
    await expect(m.billing(ctx, '66-00003.000')).rejects.toThrow('no current owner to bill');
    await expect(m.billing(ctx, '66-00001.000')).rejects.toThrow('no unit address to bill');
  });

  test('no user source is no owners', async () => {
    const m = new ResidencyManager({ accommodation: () => undefined });
    expect(await m.owners(ctx, '66-00001.000')).toEqual([]);
  });


  describe('reconcileRoles: the owner and occupant roles follow the facts (#23)', () => {
    /** A stand-in RoleManager: who holds what, and every change it was asked for, with the context. */
    const holdsCtx: unknown[] = [];
    function roleDoor(held: Record<string, string[]>) {
      const calls: Array<[string, string, string, unknown]> = [];
      const door: RoleDoor = {
        holds: async (c, u, r) => { holdsCtx.push(c); return (held[u] ?? []).includes(r); },
        assign: async (u, r, c) => { calls.push(['assign', u, r, c]); held[u] = [...(held[u] ?? []), r]; },
        remove: async (u, r, c) => { calls.push(['remove', u, r, c]); held[u] = (held[u] ?? []).filter(x => x !== r); }
      };
      return { door, calls, held };
    }

    test('gives each role to whoever has a current entry, and takes it from whoever has none', async () => {
      const m = open();
      const { door, calls } = roleDoor({ 'old.owner': ['owner'], 'moving.in': ['occupant'], 'lee.renter': ['occupant'], admin: ['admin'] });
      const result = await m.reconcileRoles(ctx, door);
      expect(result.assigned).toEqual([
        { username: 'kim.both', role: 'owner' },
        { username: 'kim.both', role: 'occupant' },
        { username: 'pat.example', role: 'owner' },
        { username: 'sam.example', role: 'owner' }
      ]);
      expect(result.removed).toEqual([
        { username: 'moving.in', role: 'occupant' }, // starts next month
        { username: 'old.owner', role: 'owner' } // sold in 2015
      ]);
      expect(calls.every(c => c[3] === ctx)).toBe(true); // every change is made as the caller
      expect(holdsCtx.length > 0 && holdsCtx.every(c => c === ctx)).toBe(true); // and every lookup asks as the caller (ngdpbase 5.28.0)
    });

    test('a second run changes nothing', async () => {
      const m = open();
      const { door, calls } = roleDoor({});
      await m.reconcileRoles(ctx, door);
      const first = calls.length;
      expect(await m.reconcileRoles(ctx, door)).toEqual({ assigned: [], removed: [], leftAlone: [], failed: [] });
      expect(calls).toHaveLength(first);
    });

    test('a role is never taken away over an entry that cannot be read', async () => {
      const m = open();
      const { door, held } = roleDoor({ 'broken.links': ['owner'] });
      const result = await m.reconcileRoles(ctx, door);
      expect(result.leftAlone).toEqual([{ username: 'broken.links', role: 'owner' }]);
      expect(held['broken.links']).toEqual(['owner']);
    });

    test('a change RoleManager refuses is listed with its error, and the rest still run', async () => {
      const m = open();
      const { door } = roleDoor({});
      const refusing: RoleDoor = { ...door, assign: async (u, r, c) => {
        if (u === 'kim.both' && r === 'owner') throw new Error('no Person for kim.both');
        await door.assign(u, r, c);
      } };
      const result = await m.reconcileRoles(ctx, refusing);
      expect(result.failed).toEqual([{ username: 'kim.both', role: 'owner', change: 'assign', error: 'no Person for kim.both' }]);
      expect(result.assigned.map(a => `${a.username} ${a.role}`)).toEqual(['kim.both occupant', 'lee.renter occupant', 'pat.example owner', 'sam.example owner']);
    });

    test('a readable current entry still gives the role beside an unreadable one', async () => {
      const users = [{ username: 'x', ownership: [
        { typeOfGood: 'p1', ownedFrom: '2020-01-01', ownedThrough: 'current', share: 100 },
        { typeOfGood: 'p2', ownedFrom: 'soon', ownedThrough: 'current', share: 100 }] }];
      const m = new ResidencyManager({ users: async () => users, accommodation: () => undefined, today: () => TEST_TODAY });
      const { door } = roleDoor({});
      expect((await m.reconcileRoles(ctx, door)).assigned).toEqual([{ username: 'x', role: 'owner' }]);
    });
  });
});
