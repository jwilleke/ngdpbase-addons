/**
 * ResidencyManager.ownUnits: a resident's own page (#36). The door decides with the resident's
 * context; the other people are read under the system context, and only what the viewer may see
 * comes back. No files are written.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import { buildAddonHost } from '@jwilleke/ngdpbase-types/testing';
import ResidencyManager from '../managers/ResidencyManager.js';
import { AccommodationRefusedError } from '../managers/AccommodationManager.js';
import { SAMPLE_ACCOMMODATIONS, SAMPLE_USERS, TEST_TODAY } from './fixtures.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const host = buildAddonHost('accommodation', defaults);
const as = (username: string, roles: string[] = []) => ({ username, roles, isAuthenticated: true }) as unknown as ActorContext;

// lee.renter with an email, to show who is given it
const USERS = SAMPLE_USERS.map(u => (u.username === 'lee.renter' ? { ...u, email: 'lee@example.org' } : u));

function open() {
  const readAs: unknown[] = [];
  const byId = new Map(SAMPLE_ACCOMMODATIONS.map(u => [u.id, u]));
  const m = new ResidencyManager({
    users: async (c) => { readAs.push(c); return USERS; },
    accommodation: (id) => byId.get(id),
    today: () => TEST_TODAY,
    // every user holds accommodation-self through vault-owner; 'visitor' stands for anonymous
    decide: async (c) => ({ permit: (c as { username?: string }).username !== 'visitor', applicable: true, reason: 'test' }),
    systemContext: (reason) => ({ username: 'system', roles: [], isAuthenticated: true, reason }) as unknown as ActorContext
  });
  return { m, readAs };
}

describe('ResidencyManager.ownUnits (#36)', () => {
  test('an owner sees their unit, its owners by name, its occupants with emails, and its billing entries', async () => {
    const { m, readAs } = open();
    const [unit, ...rest] = await m.ownUnits(as('pat.example'));
    expect(rest).toEqual([]);
    expect(unit).toMatchObject({
      id: '66-00001.000', as: ['owner'],
      owners: [{ name: 'Pat Example' }, { name: 'Sam Example' }],
      occupants: [{ name: 'Lee Renter', email: 'lee@example.org' }] // moving.in starts next month
    });
    expect(unit.owners[0]).not.toHaveProperty('email'); // co-owners by name only
    expect(unit.billing?.map(b => [b.address.split('\n')[0], b.share])).toEqual([['PAT EXAMPLE', 60], ['SAM EXAMPLE', 40]]);
    // the people were read as the system, with a reason naming the resident — not as the resident
    expect(readAs.every(c => (c as { reason?: string }).reason === 'accommodation: own units and their residents, for pat.example')).toBe(true);
  });

  test('an occupant sees the owners by name, not even their own email, and no billing entries', async () => {
    const { m } = open();
    expect(await m.ownUnits(as('lee.renter'))).toEqual([
      { id: '66-00001.000', as: ['occupant'], owners: [{ name: 'Pat Example' }, { name: 'Sam Example' }], occupants: [{ name: 'Lee Renter' }] }
    ]);
  });

  test('someone who owns and lives in a unit sees it once, as both', async () => {
    const { m } = open();
    expect((await m.ownUnits(as('kim.both'))).map(u => [u.id, u.as])).toEqual([['66-00002.000', ['owner', 'occupant']]]);
  });

  test('only current entries count: a past owner and a future occupant see nothing', async () => {
    const { m } = open();
    expect(await m.ownUnits(as('old.owner'))).toEqual([]);
    expect(await m.ownUnits(as('moving.in'))).toEqual([]);
    expect(await m.ownUnits(as('admin'))).toEqual([]); // an admin role gives no own units
  });

  test('refused without accommodation-self, before anyone is read', async () => {
    const { m, readAs } = open();
    await expect(m.ownUnits(as('visitor'))).rejects.toBeInstanceOf(AccommodationRefusedError);
    expect(readAs).toEqual([]);
  });
});

describe('ResidencyManager.setBilling (ngdpbase#2042)', () => {
  function withBilling(options: { auditFails?: boolean } = {}) {
    const order: string[] = [];
    const audits: Array<Record<string, unknown>> = [];
    const written: Array<[unknown, string, unknown]> = [];
    const notices: string[] = [];
    const units = new Map(SAMPLE_ACCOMMODATIONS.map(u => [u.id, structuredClone(u)]));
    const m = new ResidencyManager({
      users: async () => USERS,
      accommodation: (id) => units.get(id),
      today: () => TEST_TODAY,
      // 'treasurer' holds accommodation-manage; every user but 'visitor' holds accommodation-self
      decide: async (c, { action }) => {
        const who = (c as { username?: string }).username;
        return { permit: action === 'accommodation-manage' ? who === 'treasurer' : who !== 'visitor', applicable: true, reason: 'test' };
      },
      systemContext: (reason) => ({ username: 'system', roles: [], isAuthenticated: true, reason }) as unknown as ActorContext,
      changes: {
        host,
        decide: async () => ({ permit: false, applicable: true, reason: 'not used here' }),
        recordAudit: async (r) => {
          if (options.auditFails) throw new Error('audit sink down');
          order.push(`audit:${r.result ?? 'success'}`); audits.push(r as never);
        },
        updateUser: async () => undefined,
        writeBilling: async (sys, id, billing) => { order.push('write'); written.push([sys, id, billing]); units.set(id, { ...units.get(id)!, billing }); },
        notify: async (_t, message) => { order.push('notice'); notices.push(message); }
      }
    });
    return { m, order, audits, written, notices, units };
  }
  const TWO = [{ address: 'PAT EXAMPLE\n9 New Rd\nColumbus OH 43215', share: 70 }, { address: 'SAM EXAMPLE\n1 Other St', share: 30 }];

  test('an owner sets every entry, as the treasurer can: recorded as the owner, written as the system, the board told', async () => {
    const t = withBilling();
    await t.m.setBilling(as('sam.example'), '66-00001.000', TWO);
    expect(t.order).toEqual(['audit:success', 'write', 'notice']);
    expect(t.audits[0]).toMatchObject({ user: 'sam.example', action: 'billing-set', resource: '66-00001.000', metadata: { by: 'owner', entries: 2, fields: ['billing'] } });
    expect(JSON.stringify(t.audits[0])).not.toContain('New Rd'); // counts, never the addresses
    const [sys, , billing] = t.written[0] as [{ reason: string }, string, unknown];
    expect(sys.reason).toBe('accommodation: billing entries of unit 66-00001.000, set by owner sam.example');
    expect(billing).toEqual(TWO);
    expect(t.notices).toEqual(['An owner of unit 66-00001.000 changed where its invoices go.']);
  });

  test('the treasurer sets them for any unit; one entry with no share is 100%; none goes back to the unit address', async () => {
    const t = withBilling();
    await t.m.setBilling(as('treasurer'), '66-00002.000', [{ address: 'KIM BOTH & SAM EXAMPLE\n103 Sample Dr' }]);
    expect(t.written[0][2]).toEqual([{ address: 'KIM BOTH & SAM EXAMPLE\n103 Sample Dr', share: 100 }]);
    expect(t.audits[0]).toMatchObject({ metadata: { by: 'treasurer', entries: 1 } });
    expect(t.notices).toEqual(['The treasurer changed where the invoices of unit 66-00002.000 go.']);
    await t.m.setBilling(as('treasurer'), '66-00002.000', []);
    expect(t.written[1][2]).toBeUndefined();
  });

  test.each([
    ['lee.renter', '66-00001.000', TWO, 'you are not a current owner of unit 66-00001.000'],
    ['old.owner', '66-00001.000', TWO, 'you are not a current owner'],
    ['pat.example', '66-00001.000', [{ address: 'A', share: 60 }], 'billing shares add up to 60%, not 100%'],
    ['pat.example', '66-00001.000', [{ address: 'A', share: 50 }, { address: 'B' }], 'billing entry 2: the share must be a percent above 0'],
    ['pat.example', '66-00001.000', [{ address: ' ', share: 100 }], 'billing entry 1 has no address'],
    ['pat.example', '66-00001.000', [{ to: ['pat.example'], address: 'A', share: 100 }], 'earlier shape'],
    ['pat.example', '99-99999.000', TWO, 'no accommodation 99-99999.000']
  ])('refuses %s on %s: %o, writing nothing', async (who, unit, entries, message) => {
    const t = withBilling();
    await expect(t.m.setBilling(as(who), unit, entries)).rejects.toThrow(message);
    expect(t.order).toEqual([]);
  });

  test('refused without accommodation-self; a record that cannot be written refuses the change', async () => {
    await expect(withBilling().m.setBilling(as('visitor'), '66-00001.000', TWO)).rejects.toBeInstanceOf(AccommodationRefusedError);
    const t = withBilling({ auditFails: true });
    await expect(t.m.setBilling(as('pat.example'), '66-00001.000', TWO)).rejects.toThrow('audit sink down');
    expect(t.written).toEqual([]);
    expect(t.notices).toEqual([]);
  });

  test('the earlier shape converts once, unit by unit; a unit naming a username with no account is left as it is', async () => {
    const t = withBilling();
    t.units.set('66-00001.000', { ...t.units.get('66-00001.000')!, billing: [
      { to: ['pat.example', 'sam.example'], address: { streetAddress: '101 Sample Dr', addressLocality: 'Mount Vernon', addressRegion: 'OH', postalCode: '43050' }, share: 100 }] });
    t.units.set('66-00002.000', { ...t.units.get('66-00002.000')!, billing: [{ to: ['gone.user'], address: { streetAddress: 'A' }, share: 100 }] });
    const sys = { username: 'system', reason: 'start-up' } as unknown as ActorContext;
    expect(await t.m.convertBilling(sys, ['66-00001.000', '66-00002.000', '66-00003.000'])).toEqual({ converted: 1, untouched: ['66-00002.000'] });
    expect(t.units.get('66-00001.000')?.billing).toEqual([{ address: 'Pat Example & Sam Example\n101 Sample Dr\nMount Vernon OH 43050', share: 100 }]);
    expect(t.units.get('66-00002.000')?.billing).toEqual([{ to: ['gone.user'], address: { streetAddress: 'A' }, share: 100 }]);
    expect(t.written.map(w => w[0])).toEqual([sys]);
    expect(await t.m.convertBilling(sys, ['66-00001.000'])).toEqual({ converted: 0, untouched: [] }); // once
  });
});

describe('ResidencyManager.updateOccupantDetails (#37)', () => {
  function withIdentities(options: { auditFails?: boolean } = {}) {
    const order: string[] = [];
    const audits: Array<Record<string, unknown>> = [];
    const patches: Array<[unknown, string, Record<string, unknown>]> = [];
    const notices: string[] = [];
    const byId = new Map(SAMPLE_ACCOMMODATIONS.map(u => [u.id, u]));
    const records: Record<string, { id: string; contactPoint: unknown[] }> = {
      'lee.renter': { id: 'urn:uuid:lee', contactPoint: [
        { '@type': 'ContactPoint', contactType: 'home', telephone: '555-0001' },
        { '@type': 'ContactPoint', contactType: 'emergency', name: 'Old', telephone: '555-0009' },
        { '@type': 'PostalAddress', contactType: 'mailing', streetAddress: 'PO Box 7' }
      ] }
    };
    const m = new ResidencyManager({
      users: async () => USERS,
      accommodation: (id) => byId.get(id),
      today: () => TEST_TODAY,
      decide: async (c) => ({ permit: (c as { username?: string }).username !== 'visitor', applicable: true, reason: 'test' }),
      systemContext: (reason) => ({ username: 'system', roles: [], isAuthenticated: true, reason }) as unknown as ActorContext,
      identities: {
        find: async (_sys, username) => records[username] ?? null,
        update: async (sys, id, patch) => { order.push('write'); patches.push([sys, id, patch]); }
      },
      changes: {
        host,
        decide: async () => ({ permit: false, applicable: true, reason: 'not used here' }),
        recordAudit: async (r) => {
          if (options.auditFails) throw new Error('audit sink down');
          order.push(`audit:${r.result ?? 'success'}`); audits.push(r as never);
        },
        updateUser: async () => undefined,
        notify: async (_t, message) => { order.push('notice'); notices.push(message); }
      }
    });
    return { m, order, audits, patches, notices };
  }

  test('an owner sees their occupant\'s details, and changes them: recorded as the owner, written as the system', async () => {
    const t = withIdentities();
    const [unit] = await t.m.ownUnits(as('pat.example'));
    expect(unit.occupants[0].details).toMatchObject({ homePhone: '555-0001', emergencyName: 'Old', emergencyPhone: '555-0009', otherPhone: '' });
    t.order.length = 0;

    await t.m.updateOccupantDetails(as('pat.example'), '66-00001.000', 'lee.renter',
      { homePhone: '555-0100', otherPhone: '', businessPhone: '555-0200', emergencyName: 'Kim', emergencyPhone: '555-0199' });
    expect(t.order).toEqual(['audit:success', 'write', 'notice']);
    expect(t.audits[0]).toMatchObject({ user: 'pat.example', action: 'occupant-details-set', resource: '66-00001.000',
      metadata: { occupant: 'lee.renter', fields: ['homePhone', 'businessPhone', 'emergencyName', 'emergencyPhone'] } });
    expect(JSON.stringify(t.audits[0])).not.toMatch(/555-01|Kim/);
    const [sys, id, patch] = t.patches[0] as [{ reason: string }, string, { contactPoint: unknown[] }];
    expect(id).toBe('urn:uuid:lee');
    expect(sys.reason).toBe('accommodation: pat.example, an owner of unit 66-00001.000, changes the contact details of its occupant lee.renter');
    expect(patch.contactPoint).toEqual([
      { '@type': 'PostalAddress', contactType: 'mailing', streetAddress: 'PO Box 7' }, // a kind an owner may not change is kept
      { '@type': 'ContactPoint', contactType: 'home', telephone: '555-0100' },
      { '@type': 'ContactPoint', contactType: 'business', telephone: '555-0200' },
      { '@type': 'ContactPoint', contactType: 'emergency', name: 'Kim', telephone: '555-0199' }
    ]);
    expect(t.notices).toEqual(["An owner of unit 66-00001.000 changed an occupant's contact details."]);
  });

  test.each([
    ['lee.renter', '66-00001.000', 'lee.renter', { homePhone: '1' }, 'you are not a current owner'],
    ['pat.example', '66-00001.000', 'moving.in', { homePhone: '1' }, 'moving.in is not a current occupant'],
    ['pat.example', '66-00001.000', 'sam.example', { homePhone: '1' }, 'sam.example is not a current occupant'],
    ['pat.example', '66-00001.000', 'lee.renter', { email: 'x@example.org' }, 'an owner may not change email'],
    ['pat.example', '66-00001.000', 'lee.renter', { homeAddress: '1 Main' }, 'an owner may not change homeAddress'],
    ['kim.both', '66-00002.000', 'kim.both', { homePhone: '1' }, 'kim.both has no identity record']
  ])('refuses %s changing %s\'s %s %o, writing nothing', async (who, unit, occupant, answers, message) => {
    const t = withIdentities();
    await expect(t.m.updateOccupantDetails(as(who), unit, occupant, answers)).rejects.toThrow(message);
    expect(t.order).toEqual([]);
  });

  test('refused without accommodation-self; a record that cannot be written refuses the change', async () => {
    await expect(withIdentities().m.updateOccupantDetails(as('visitor'), '66-00001.000', 'lee.renter', { homePhone: '1' })).rejects.toBeInstanceOf(AccommodationRefusedError);
    const t = withIdentities({ auditFails: true });
    await expect(t.m.updateOccupantDetails(as('pat.example'), '66-00001.000', 'lee.renter', { homePhone: '1' })).rejects.toThrow('audit sink down');
    expect(t.patches).toEqual([]);
  });

  test('an occupant does not see their own contact details through the owner view', async () => {
    const [unit] = await withIdentities().m.ownUnits(as('lee.renter'));
    expect(unit.occupants[0]).not.toHaveProperty('details');
  });
});

describe('ResidencyManager.addOccupant (#37)', () => {
  function withAccounts(options: { inviteFails?: boolean; createFails?: boolean } = {}) {
    let users = structuredClone([...USERS, { username: 'friend', displayName: 'A Friend', email: 'friend@example.org' }]) as typeof USERS;
    const order: string[] = [];
    const audits: Array<Record<string, unknown>> = [];
    const made: Array<[unknown, unknown]> = [];
    const notices: string[] = [];
    const byId = new Map(SAMPLE_ACCOMMODATIONS.map(u => [u.id, u]));
    const decide = async (c: ActorContext, { action }: { action: string }) =>
      ({ permit: action === 'accommodation-self' && (c as { username?: string }).username !== 'visitor', applicable: true, reason: 'test' });
    const m = new ResidencyManager({
      users: async () => structuredClone(users),
      accommodation: (id) => byId.get(id),
      today: () => TEST_TODAY,
      decide,
      systemContext: (reason) => ({ username: 'system', roles: [], isAuthenticated: true, reason }) as unknown as ActorContext,
      changes: {
        host, decide,
        recordAudit: async (r) => { order.push(`audit:${r.action}:${r.result ?? 'success'}`); audits.push(r as never); },
        updateUser: async (username, update) => {
          const fields = await update(structuredClone(users.find(u => u.username === username)!) as Record<string, unknown>);
          if (fields) { order.push('write'); users = users.map(u => (u.username === username ? { ...u, ...fields } : u)); }
        },
        createUser: async (sys, user) => {
          order.push('create'); made.push([sys, user]);
          if (options.createFails) throw new Error('username taken');
          users = [...users, { username: user.username, displayName: user.displayName, email: user.email }];
          return { username: user.username };
        },
        inviteUser: async () => { order.push('invite'); return options.inviteFails ? { outcome: 'email-unavailable', reason: 'email is off' } : { outcome: 'sent' }; },
        notify: async (_t, message) => { order.push('notice'); notices.push(message); }
      }
    });
    const occupiesOf = (u: string) => (users.find(x => x.username === u) as { occupies?: unknown[] } | undefined)?.occupies;
    return { m, order, audits, made, notices, occupiesOf };
  }

  test('someone with an account, found by email: recorded as the owner, then the entry added, the board told', async () => {
    const t = withAccounts();
    expect(await t.m.addOccupant(as('pat.example'), '66-00001.000', { email: 'Friend@Example.org', name: 'A Friend', from: '2026-10-20' }))
      .toEqual({ username: 'friend', created: false });
    // the owner's own record first, then changeLink's record of the entry, the write, the notice; no account made
    expect(t.order).toEqual(['audit:occupant-add:success', 'audit:occupant-add:success', 'write', 'notice']);
    expect(t.audits.map(r => r.eventType)).toEqual(['accommodation-occupant-add', 'accommodation-manage']);
    expect(t.occupiesOf('friend')).toEqual([{ roleName: 'occupant', accommodation: '66-00001.000', startDate: '2026-10-20', endDate: 'current' }]);
    expect(t.audits[0]).toMatchObject({ user: 'pat.example', resource: '66-00001.000', metadata: { occupant: 'friend', newAccount: false } });
    expect(t.notices).toEqual(['An owner of unit 66-00001.000 added an occupant.']);
  });

  test('someone with no account: made with no password and invited, as the system naming the owner and unit', async () => {
    const t = withAccounts();
    expect(await t.m.addOccupant(as('pat.example'), '66-00001.000', { email: 'new@example.org', name: 'New Person', username: 'new.person', from: '2026-10-20' }))
      .toEqual({ username: 'new.person', created: true, invitation: { outcome: 'sent' } });
    expect(t.order.slice(0, 3)).toEqual(['audit:occupant-add:success', 'create', 'invite']);
    const [sys, user] = t.made[0] as [{ reason: string }, Record<string, string>];
    expect(sys.reason).toBe('accommodation: pat.example, an owner of unit 66-00001.000, adds an occupant');
    expect(user).toEqual({ username: 'new.person', email: 'new@example.org', displayName: 'New Person' });
    expect(t.occupiesOf('new.person')).toHaveLength(1);
    expect(t.notices).toEqual(['An owner of unit 66-00001.000 added an occupant with a new account.']);
  });

  test('an invitation that could not be sent is reported; the occupant is still added', async () => {
    const t = withAccounts({ inviteFails: true });
    expect(await t.m.addOccupant(as('pat.example'), '66-00001.000', { email: 'new@example.org', name: 'N', username: 'new.person', from: '2026-10-20' }))
      .toMatchObject({ created: true, invitation: { outcome: 'email-unavailable', reason: 'email is off' } });
    expect(t.occupiesOf('new.person')).toHaveLength(1);
  });

  test.each([
    ['lee.renter', { email: 'friend@example.org', name: 'F', from: '2026-10-20' }, 'you are not a current owner'],
    ['pat.example', { email: 'not-an-email', name: 'F', from: '2026-10-20' }, 'needs an email address'],
    ['pat.example', { email: 'new@example.org', name: 'N', from: '2026-10-20' }, 'give a username for a new one'],
    ['pat.example', { email: 'friend@example.org', name: 'F', from: '2026-13-40' }, 'must be a date'],
    ['pat.example', { email: 'friend@example.org', name: 'F', from: '2026-10-20', to: '2026-01-01' }, 'before it starts']
  ])('refuses %s adding %o, writing nothing', async (who, person, message) => {
    const t = withAccounts();
    await expect(t.m.addOccupant(as(who), '66-00001.000', person)).rejects.toThrow(message);
    expect(t.order).toEqual([]);
  });

  test('an account that cannot be made is recorded as a failure, and no entry is added', async () => {
    const t = withAccounts({ createFails: true });
    await expect(t.m.addOccupant(as('pat.example'), '66-00001.000', { email: 'new@example.org', name: 'N', username: 'new.person', from: '2026-10-20' })).rejects.toThrow('username taken');
    expect(t.order).toEqual(['audit:occupant-add:success', 'create', 'audit:occupant-add:failure']);
  });

  test('refused without accommodation-self', async () => {
    await expect(withAccounts().m.addOccupant(as('visitor'), '66-00001.000', { email: 'a@example.org', name: 'A', from: '2026-10-20' })).rejects.toBeInstanceOf(AccommodationRefusedError);
  });
});
