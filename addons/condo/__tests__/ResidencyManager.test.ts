/**
 * ResidencyManager: owners and occupants from the dated links on user records
 * (#15), read as the caller. No files are written.
 */
import { describe, expect, test } from 'vitest';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import ResidencyManager from '../managers/ResidencyManager.js';
import type { CondoUnit } from '../providers/CondoUnitProvider.js';
import { SAMPLE_UNITS, SAMPLE_USERS, TEST_TODAY } from './fixtures.js';

const ctx = { username: 'treasurer', roles: [], isAuthenticated: true } as unknown as ActorContext;

describe('ResidencyManager', () => {
  let asked: unknown[] = [];

  function open(units: CondoUnit[] = SAMPLE_UNITS): ResidencyManager {
    asked = [];
    const byId = new Map(units.map(u => [u.id, u]));
    return new ResidencyManager({
      users: async (c) => { asked.push(c); return SAMPLE_USERS; },
      unit: (id) => byId.get(id),
      today: () => TEST_TODAY
    });
  }

  test('owners are the users with a current owner link: given shares kept, the rest split evenly', async () => {
    const m = open();
    expect(await m.owners(ctx, '66-00001.000')).toEqual([
      { username: 'pat.example', name: 'Pat Example', email: 'pat@example.org', share: 60 },
      { username: 'sam.example', name: 'Sam Example', email: null, share: 40 }
    ]); // old.owner's link ended in 2015; broken.links is malformed and left out
    // sam.example owns two units; no displayName falls back to the username
    expect(await m.owners(ctx, '66-00002.000')).toEqual([
      { username: 'kim.both', name: 'kim.both', email: null, share: 50 },
      { username: 'sam.example', name: 'Sam Example', email: null, share: 50 }
    ]);
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
    expect(await m.linkProblems(ctx)).toEqual(['broken.links: condoUnits[0].to must be a date YYYY-MM-DD or "current"']);
  });

  test('owners refuses shares over 100%', async () => {
    const m = open([{ id: '66-00001.000', shares: { 'pat.example': 70, 'sam.example': 40 } }]);
    await expect(m.owners(ctx, '66-00001.000')).rejects.toThrow('110%');
  });

  test('no user source is no owners', async () => {
    const m = new ResidencyManager({ unit: () => undefined });
    expect(await m.owners(ctx, '66-00001.000')).toEqual([]);
  });

});
