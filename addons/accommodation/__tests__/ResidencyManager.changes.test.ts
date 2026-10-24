/**
 * ResidencyManager.changeLink: the admin page's changes to the dated entries (#28),
 * against stand-in UserManager, decision point, audit sink and roles job. No files are written.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import { buildAddonHost } from '@jwilleke/ngdpbase-types/testing';
import ResidencyManager, { LinkChangeRefusedError, type UserRecord } from '../managers/ResidencyManager.js';
import { AccommodationRefusedError, type AccommodationAuditRecord } from '../managers/AccommodationManager.js';
import { SAMPLE_ACCOMMODATIONS, SAMPLE_USERS, TEST_TODAY } from './fixtures.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const host = buildAddonHost('accommodation', defaults);
const GRANTS: Record<string, string[]> = { treasurer: ['accommodation-read', 'accommodation-manage'], board: ['accommodation-read'] };

function contextFor(username: string): ActorContext {
  return { username, roles: [], isAuthenticated: true, ipAddress: '192.0.2.1' } as unknown as ActorContext;
}
const treasurer = contextFor('treasurer');

describe('ResidencyManager.changeLink (#28)', () => {
  let users: UserRecord[];
  let audits: AccommodationAuditRecord[];
  let order: string[];
  let auditFails: boolean;
  let writeFails: boolean;
  let followed: unknown[];

  beforeEach(() => {
    users = structuredClone(SAMPLE_USERS);
    audits = []; order = []; auditFails = false; writeFails = false; followed = [];
  });

  function open(): ResidencyManager {
    const byId = new Map(SAMPLE_ACCOMMODATIONS.map(u => [u.id, u]));
    return new ResidencyManager({
      users: async () => structuredClone(users),
      accommodation: (id) => byId.get(id),
      today: () => TEST_TODAY,
      changes: {
        host,
        decide: async (c, { action }) => ({ permit: (GRANTS[(c as { username?: string }).username ?? ''] ?? []).includes(action), applicable: true, reason: 'test' }),
        recordAudit: async (record) => {
          if (auditFails) throw new Error('audit sink down');
          order.push(`audit:${record.result ?? 'success'}`);
          audits.push(record);
        },
        updateUser: async (username, fields, ctx) => {
          if (writeFails) throw new Error('disk full');
          order.push('write');
          expect(ctx).toBe(treasurer); // written as the caller
          users = users.map(u => (u.username === username ? { ...u, ...fields } : u));
        },
        followRoles: async (c) => { order.push('roles-job'); followed.push(c); }
      }
    });
  }

  const ownershipOf = (username: string) => users.find(u => u.username === username)?.ownership;
  const occupiesOf = (username: string) => users.find(u => u.username === username)?.occupies;
  const at = (username: string, type: 'owner' | 'occupant', index: number) => {
    const list = (type === 'owner' ? ownershipOf(username) : occupiesOf(username)) as unknown[];
    return { type, index, expected: JSON.stringify(list[index]) };
  };

  test('adds an owner entry, recorded first, then starts the roles job as the caller', async () => {
    const m = open();
    const result = await m.changeLink(treasurer, 'admin', { op: 'add', link: { parcel: '66-00003.000', type: 'owner', from: '2026-10-01', to: 'current', share: 100 } });
    expect(ownershipOf('admin')).toEqual([{ typeOfGood: '66-00003.000', ownedFrom: '2026-10-01', ownedThrough: 'current', share: 100 }]);
    expect(order).toEqual(['audit:success', 'write', 'roles-job']);
    expect(audits[0]).toMatchObject({
      user: 'treasurer', action: 'owner-add', resource: '66-00003.000', resourceType: 'accommodation',
      metadata: { username: 'admin', owner: 'admin', field: 'ownership', fields: ['ownedFrom', 'ownedThrough', 'share', 'typeOfGood'] }
    });
    expect(JSON.stringify(audits[0])).not.toContain('2026-10-01'); // names, never values
    expect(result).toEqual({ changed: true });
    expect(followed).toEqual([treasurer]);
  });

  test('ends a current occupancy on a date', async () => {
    const m = open();
    await m.changeLink(treasurer, 'lee.renter', { op: 'end', at: at('lee.renter', 'occupant', 0), on: '2026-09-30' });
    expect(occupiesOf('lee.renter')).toEqual([{ roleName: 'occupant', accommodation: '66-00001.000', startDate: '2023-02-01', endDate: '2026-09-30' }]);
    expect(audits[0]).toMatchObject({ action: 'occupant-end', metadata: { fields: ['endDate'] } });
  });

  test('corrects an entry, keeping fields the page does not show, and fixes a malformed one', async () => {
    users = users.map(u => (u.username === 'pat.example'
      ? { ...u, ownership: [{ typeOfGood: '66-00001.000', ownedFrom: '2015-06-01', ownedThrough: 'current', share: 50, acquiredFrom: 'old.owner' }] } : u));
    const m = open();
    await m.changeLink(treasurer, 'pat.example', { op: 'correct', at: at('pat.example', 'owner', 0), link: { parcel: '66-00001.000', type: 'owner', from: '2015-06-15', to: 'current', share: 50 } });
    expect(ownershipOf('pat.example')).toEqual([{ typeOfGood: '66-00001.000', ownedFrom: '2015-06-15', ownedThrough: 'current', share: 50, acquiredFrom: 'old.owner' }]);
    expect(audits[0]).toMatchObject({ action: 'owner-correct', metadata: { fields: ['ownedFrom'] } });

    await m.changeLink(treasurer, 'broken.links', { op: 'correct', at: at('broken.links', 'owner', 0), link: { parcel: '66-00001.000', type: 'owner', from: '2020-01-01', to: '2021-12-31', share: 100 } });
    expect(ownershipOf('broken.links')).toEqual([{ typeOfGood: '66-00001.000', ownedFrom: '2020-01-01', ownedThrough: '2021-12-31', share: 100 }]);
  });

  test('a correction that changes nothing writes and records nothing', async () => {
    const m = open();
    const link = { parcel: '66-00001.000', type: 'owner' as const, from: '2015-06-01', to: 'current', share: 50 };
    expect(await m.changeLink(treasurer, 'pat.example', { op: 'correct', at: at('pat.example', 'owner', 0), link })).toEqual({ changed: false });
    expect(order).toEqual([]);
  });

  test('removes an entry entered by mistake', async () => {
    const m = open();
    await m.changeLink(treasurer, 'sam.example', { op: 'remove', at: at('sam.example', 'owner', 1) });
    expect(ownershipOf('sam.example')).toEqual([{ typeOfGood: '66-00001.000', ownedFrom: '2015-06-01', ownedThrough: 'current', share: 50 }]);
    expect(audits[0]).toMatchObject({ action: 'owner-remove', resource: '66-00002.000', metadata: { fields: [] } });
  });

  test('refused by policy: nothing recorded, nothing written', async () => {
    const m = open();
    const change = { op: 'add' as const, link: { parcel: '66-00003.000', type: 'owner' as const, from: '2026-10-01', to: 'current', share: 100 } };
    await expect(m.changeLink(contextFor('board'), 'admin', change)).rejects.toBeInstanceOf(AccommodationRefusedError);
    // sabotage check: a role named "admin" in the subject does not stand in for the permission
    await expect(m.changeLink({ username: 'board', roles: ['admin'], isAuthenticated: true } as unknown as ActorContext, 'admin', change)).rejects.toBeInstanceOf(AccommodationRefusedError);
    expect(order).toEqual([]);
  });

  test('an audit record that cannot be written refuses the change', async () => {
    const m = open();
    auditFails = true;
    await expect(m.changeLink(treasurer, 'admin', { op: 'add', link: { parcel: '66-00003.000', type: 'owner', from: '2026-10-01', to: 'current', share: 100 } })).rejects.toThrow('audit sink down');
    expect(ownershipOf('admin')).toBeUndefined();
  });

  test('a write that fails is recorded as a failure and thrown; the roles job is not started', async () => {
    const m = open();
    writeFails = true;
    await expect(m.changeLink(treasurer, 'admin', { op: 'add', link: { parcel: '66-00003.000', type: 'owner', from: '2026-10-01', to: 'current', share: 100 } })).rejects.toThrow('disk full');
    expect(order).toEqual(['audit:success', 'audit:failure']);
    expect(audits[1].metadata).toMatchObject({ reason: 'disk full' });
    expect(followed).toEqual([]);
  });

  test.each([
    ['nobody', { op: 'add', link: { parcel: '66-00003.000', type: 'owner', from: '2026-10-01', to: 'current', share: 100 } }, 'no account named nobody'],
    ['admin', { op: 'add', link: { parcel: '99-99999.000', type: 'owner', from: '2026-10-01', to: 'current', share: 100 } }, 'no accommodation 99-99999.000'],
    ['admin', { op: 'add', link: { parcel: '66-00003.000', type: 'owner', from: '2026-13-01', to: 'current', share: 100 } }, 'must be a date YYYY-MM-DD'],
    ['admin', { op: 'add', link: { parcel: '66-00003.000', type: 'owner', from: '2026-10-01', to: 'soon', share: 100 } }, 'or "current"'],
    ['admin', { op: 'add', link: { parcel: '66-00003.000', type: 'owner', from: '2026-10-01', to: 'current', share: Number.NaN } }, 'share must be a percent'],
    ['admin', { op: 'add', link: { parcel: '66-00003.000', type: 'occupant', from: '2026-10-01', to: '2026-09-01' } }, 'before it starts']
  ] as const)('refuses, with the reason, writing nothing: %s %o', async (username, change, message) => {
    const m = open();
    await expect(m.changeLink(treasurer, username, change as never)).rejects.toThrow(message);
    await expect(m.changeLink(treasurer, username, change as never)).rejects.toBeInstanceOf(LinkChangeRefusedError);
    expect(order).toEqual([]);
  });

  test('refuses an entry that changed since the page showed it', async () => {
    const m = open();
    const stale = at('pat.example', 'owner', 0);
    users = users.map(u => (u.username === 'pat.example' ? { ...u, ownership: [{ typeOfGood: '66-00001.000', ownedFrom: '2015-06-01', ownedThrough: 'current', share: 40 }] } : u));
    await expect(m.changeLink(treasurer, 'pat.example', { op: 'remove', at: stale })).rejects.toThrow('has changed since the page was shown');
    await expect(m.changeLink(treasurer, 'pat.example', { op: 'remove', at: { ...stale, index: 5 } })).rejects.toThrow('has changed since the page was shown');
    expect(order).toEqual([]);
  });

  test('ending an entry that already ended, or cannot be read, is refused: correct it instead', async () => {
    const m = open();
    await expect(m.changeLink(treasurer, 'old.owner', { op: 'end', at: at('old.owner', 'owner', 0), on: '2026-01-01' })).rejects.toThrow('already ended on 2015-05-31');
    await expect(m.changeLink(treasurer, 'broken.links', { op: 'end', at: at('broken.links', 'owner', 0), on: '2026-01-01' })).rejects.toThrow('cannot be read');
  });


  test('unitEntries: every entry naming the unit, with what the page needs, and the share check', async () => {
    const m = open();
    const { entries, shareProblems } = await m.unitEntries(treasurer, '66-00001.000');
    expect(entries.map(e => [e.username, e.type, e.index, e.link?.from ?? e.problem])).toEqual([
      ['broken.links', 'owner', 0, 'broken.links: ownership[0].ownedThrough must be a date YYYY-MM-DD or "current"'],
      ['old.owner', 'owner', 0, '2008-01-10'],
      ['pat.example', 'owner', 0, '2015-06-01'],
      ['sam.example', 'owner', 0, '2015-06-01'],
      ['lee.renter', 'occupant', 0, '2023-02-01'],
      ['moving.in', 'occupant', 0, '2026-11-01']
    ]);
    expect(entries[1].expected).toBe(JSON.stringify((ownershipOf('old.owner') as unknown[])[0]));
    expect(shareProblems).toEqual([]);
  });

  test('roster: each unit with its owners and occupants today, from one read', async () => {
    const m = open();
    const roster = await m.roster(treasurer, ['66-00001.000', '66-00003.000']);
    expect(roster.get('66-00001.000')?.owners.map(o => o.username)).toEqual(['pat.example', 'sam.example']);
    expect(roster.get('66-00001.000')?.occupants.map(o => o.username)).toEqual(['lee.renter']);
    expect(roster.get('66-00003.000')).toEqual({ owners: [], occupants: [] });
  });

  test('without its write side the manager refuses every change', async () => {
    const m = new ResidencyManager({ accommodation: () => undefined });
    await expect(m.changeLink(treasurer, 'admin', { op: 'remove', at: { type: 'owner', index: 0, expected: '' } })).rejects.toThrow('without its write side');
  });
  test('checkEntry: the same refusals changeLink makes, without writing or asking anything', () => {
    const m = open();
    expect(m.checkEntry({ parcel: '66-00001.000', type: 'owner', from: '2026-10-01', to: 'current' })).toBeNull();
    expect(m.checkEntry({ parcel: '66-00001.000', type: 'occupant', from: '2026-10-01', to: '2026-12-31' })).toBeNull();
    expect(m.checkEntry({ parcel: '99-99999.000', type: 'owner', from: '2026-10-01', to: 'current' })).toBe('no accommodation 99-99999.000');
    expect(m.checkEntry({ parcel: '66-00001.000', type: 'occupant', from: '2026-10-01', to: '2026-09-01' })).toContain('before it starts');
    expect(m.checkEntry({ parcel: '66-00001.000', type: 'owner', from: 'soon', to: 'current' })).toContain('must be a date');
    expect(order).toEqual([]);
  });
});
