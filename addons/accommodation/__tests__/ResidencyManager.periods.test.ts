/**
 * Ownership periods (#43; operator, 2026-10-26): each ownership entry names its period, one stretch
 * of the same owners and shares that accounting bills as one folio. Against stand-in UserManager,
 * decision point and audit sink. No files are written.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import { buildAddonHost } from '@jwilleke/ngdpbase-types/testing';
import ResidencyManager, { type UserRecord } from '../managers/ResidencyManager.js';
import { periodProblems } from '../managers/unitLinks.js';
import { SAMPLE_ACCOMMODATIONS, SAMPLE_USERS, TEST_TODAY } from './fixtures.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const host = buildAddonHost('accommodation', defaults);
const as = (username: string) => ({ username, roles: [], isAuthenticated: true }) as unknown as ActorContext;
const treasurer = as('treasurer');
const GRANTS: Record<string, string[]> = { treasurer: ['accommodation-manage', 'user-create', 'accommodation-billing-read'], clerk: ['accommodation-manage'] };

function open(start: UserRecord[] = SAMPLE_USERS) {
  let users: UserRecord[] = structuredClone(start);
  const audits: Array<Record<string, unknown>> = [];
  const made: string[] = [];
  const units = SAMPLE_ACCOMMODATIONS.map(u => ({ ...u, billing: [{ address: 'A' }] }));
  const decide = async (c: ActorContext, { action }: { action: string }) =>
    ({ permit: (GRANTS[(c as { username?: string }).username ?? ''] ?? []).includes(action), applicable: true, reason: 'test' });
  const m = new ResidencyManager({
    users: async () => structuredClone(users),
    accommodation: (id) => units.find(u => u.id === id),
    today: () => TEST_TODAY,
    decide,
    systemContext: (reason) => ({ username: 'system', reason }) as unknown as ActorContext,
    identities: { find: async (_c, username) => ({ id: `urn:uuid:${username}` }), update: async () => undefined },
    changes: {
      host, decide,
      recordAudit: async (r) => { audits.push(r as never); },
      updateUser: async (username, update) => {
        const fields = await update(structuredClone(users.find(u => u.username === username)!) as Record<string, unknown>);
        if (fields) users = users.map(u => (u.username === username ? { ...u, ...fields } : u));
      },
      createUser: async (_c, user) => { made.push(user.username); users = [...users, { username: user.username, displayName: user.displayName }]; return { username: user.username }; },
      inviteUser: async () => ({ outcome: 'sent' })
    }
  });
  return { m, audits, made, ownership: (u: string) => users.find(x => x.username === u)?.ownership as Array<Record<string, unknown>> | undefined };
}

describe('ownership periods (#43)', () => {
  test('billing() names the period billed; on a past date, the period then, with its end', async () => {
    const { m } = open();
    expect((await m.billing(treasurer, '66-00001.000')).period).toEqual({ id: 'p1-now', from: '2015-06-01' });
    expect((await m.billing(treasurer, '66-00001.000', { on: '2012-01-01' })).period).toEqual({ id: 'p1-old', from: '2008-01-10', through: '2015-05-31' });
  });

  test('billing() refuses owners who are not in one period, or in none', async () => {
    const mixed = SAMPLE_USERS.map(u => (u.username === 'sam.example'
      ? { ...u, ownership: [{ typeOfGood: '66-00001.000', ownedFrom: '2015-06-01', ownedThrough: 'current', share: 50, period: 'other' }] } : u));
    await expect(open(mixed).m.billing(treasurer, '66-00001.000')).rejects.toThrow('the owners on 2026-10-22 are not in one ownership period');
    const none = SAMPLE_USERS.map(u => (u.username === 'pat.example'
      ? { ...u, ownership: [{ typeOfGood: '66-00001.000', ownedFrom: '2015-06-01', ownedThrough: 'current', share: 50 }] } : u));
    await expect(open(none).m.billing(treasurer, '66-00001.000')).rejects.toThrow('not in one ownership period');
  });

  test('ownershipPeriods: every period oldest first, its owners by @id; a door like billing()', async () => {
    const { m } = open();
    expect(await m.ownershipPeriods(treasurer, '66-00001.000')).toEqual([
      { id: 'p1-old', from: '2008-01-10', through: '2015-05-31', owners: [{ '@id': 'urn:uuid:old.owner', share: 100 }] },
      { id: 'p1-now', from: '2015-06-01', owners: [{ '@id': 'urn:uuid:pat.example', share: 50 }, { '@id': 'urn:uuid:sam.example', share: 50 }] }
    ]);
    await expect(m.ownershipPeriods(as('clerk'), '66-00001.000')).rejects.toMatchObject({ permission: 'accommodation-billing-read' });
  });

  test('a correction keeps the period: an owner added joins it, an edited entry keeps its id', async () => {
    const t = open();
    await t.m.changeLink(treasurer, 'admin', { op: 'add', link: { parcel: '66-00002.000', type: 'owner', from: '2020-03-01', to: 'current', share: 10 } });
    expect(t.ownership('admin')?.[0].period).toBe('p2-now');
    const at = { type: 'owner' as const, index: 0, expected: JSON.stringify(t.ownership('pat.example')?.[0]) };
    await t.m.changeLink(treasurer, 'pat.example', { op: 'correct', at, link: { parcel: '66-00001.000', type: 'owner', from: '2015-06-02', to: 'current', share: 50 } });
    expect(t.ownership('pat.example')?.[0]).toMatchObject({ ownedFrom: '2015-06-02', period: 'p1-now' });
  });

  test('a change of ownership: current owners end the day before, the new owners start a new period', async () => {
    const t = open();
    const result = await t.m.changeOwnership(treasurer, '66-00001.000', '2026-11-01', [
      { username: 'pat.example', share: 100 }
    ]);
    expect(result.made).toEqual([]);
    expect(t.ownership('pat.example')).toEqual([
      { typeOfGood: '66-00001.000', ownedFrom: '2015-06-01', ownedThrough: '2026-10-31', share: 50, period: 'p1-now' },
      { typeOfGood: '66-00001.000', ownedFrom: '2026-11-01', ownedThrough: 'current', share: 100, period: result.period }
    ]);
    expect(t.ownership('sam.example')?.[0]).toMatchObject({ ownedThrough: '2026-10-31', period: 'p1-now' });
    expect(result.period).not.toBe('p1-now');
  });

  test('a change of ownership may name someone new: made first, with no password', async () => {
    const t = open();
    const result = await t.m.changeOwnership(treasurer, '66-00002.000', '2026-11-01', [
      { username: 'kim.both', share: 50 }, { name: 'Ann Lee', share: 50 }
    ]);
    expect(result.made).toEqual(['ann.lee']);
    expect(t.ownership('ann.lee')).toEqual([{ typeOfGood: '66-00002.000', ownedFrom: '2026-11-01', ownedThrough: 'current', share: 50, period: result.period }]);
    await expect(open().m.changeOwnership(as('clerk'), '66-00002.000', '2026-11-01', [{ name: 'Ann Lee', share: 100 }]))
      .rejects.toMatchObject({ permission: 'user-create' });
  });

  test.each([
    ['2026-11-01', [{ username: 'pat.example', share: 60 }], "add up to 60%, not 100%"],
    ['2015-06-01', [{ username: 'pat.example', share: 100 }], 'must come after that (or is it correcting a mistake?)'],
    ['soon', [{ username: 'pat.example', share: 100 }], 'must be a date'],
    ['2026-11-01', [{ username: 'pat.example', share: 50 }, { username: 'pat.example', share: 50 }], 'only once'],
    ['2026-11-01', [{ username: 'nobody', share: 100 }], 'no account named nobody'],
    ['2026-11-01', [], 'at least one owner']
  ])('a change of ownership on %s is refused before anything is written: %o', async (on, owners, message) => {
    const t = open();
    await expect(t.m.changeOwnership(treasurer, '66-00001.000', on, owners)).rejects.toThrow(message);
    expect(t.audits).toEqual([]);
    expect(t.made).toEqual([]);
  });

  test('tagPeriods: current owners share one new period, ended stretches one each, once; recorded', async () => {
    const untagged = SAMPLE_USERS.map(u => ({ ...u, ownership: Array.isArray(u.ownership)
      ? (u.ownership as Array<Record<string, unknown>>).map(({ period: _p, ...e }) => e) : u.ownership }));
    const t = open(untagged);
    expect(await t.m.tagPeriods(as('system'))).toEqual({ tagged: 5, accounts: 4 });
    const pat = t.ownership('pat.example')?.[0].period;
    expect(t.ownership('sam.example')?.[0].period).toBe(pat);
    expect(t.ownership('old.owner')?.[0].period).not.toBe(pat);
    expect(t.ownership('kim.both')?.[0].period).toBe(t.ownership('sam.example')?.[1].period);
    expect(t.audits.map(a => a.action)).toEqual(['owner-period-set', 'owner-period-set', 'owner-period-set', 'owner-period-set']);
    expect(JSON.stringify(t.audits)).not.toContain(String(pat)); // names, never values
    expect(await t.m.tagPeriods(as('system'))).toEqual({ tagged: 0, accounts: 0 });
  });

  test('periodProblems: owners holding on one day in two periods, or in none', () => {
    const link = (parcel: string, from: string, to: string, period?: string) => ({ parcel, type: 'owner' as const, from, to, share: 50, ...(period ? { period } : {}) });
    expect(periodProblems([
      { username: 'a', link: link('u1', '2020-01-01', 'current', 'x') },
      { username: 'b', link: link('u1', '2020-01-01', 'current', 'y') },
      { username: 'c', link: link('u2', '2020-01-01', 'current') }
    ])).toEqual(['unit u1: owners on 2020-01-01 are in 2 ownership periods, not one', 'unit u2: on 2020-01-01 c is in no ownership period']);
  });
});
