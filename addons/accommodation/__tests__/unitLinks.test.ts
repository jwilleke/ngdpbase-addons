import { describe, expect, test } from 'vitest';
import { holdsOn, isIsoDate, localToday, readLinks, shareProblems, type UnitLink } from '../managers/unitLinks.js';

const owned = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ typeOfGood: 'p', ownedFrom: '2020-01-01', ownedThrough: 'current', share: 100, ...over });
const occupied = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ roleName: 'occupant', accommodation: 'p', startDate: '2020-01-01', endDate: 'current', ...over });

describe('unit links', () => {
  test('reads well-formed ownership and occupies entries', () => {
    expect(readLinks({
      username: 'u',
      ownership: [{ typeOfGood: 'p1', ownedFrom: '2012-05-01', ownedThrough: '2020-08-31', share: 50 }],
      occupies: [{ roleName: 'occupant', accommodation: 'p2', startDate: '2021-01-15', endDate: 'current' }]
    })).toEqual({
      links: [
        { parcel: 'p1', type: 'owner', from: '2012-05-01', to: '2020-08-31', share: 50 },
        { parcel: 'p2', type: 'occupant', from: '2021-01-15', to: 'current' }
      ],
      problems: []
    });
    expect(readLinks({ username: 'u' })).toEqual({ links: [], problems: [] });
  });

  test.each([
    [owned({ typeOfGood: undefined }), 'ownership[0] has no typeOfGood'],
    [owned({ ownedFrom: '01/02/2020' }), 'ownership[0].ownedFrom must be a date'],
    [owned({ ownedFrom: '2020-02-30' }), 'ownership[0].ownedFrom must be a date'],
    [owned({ ownedThrough: null }), 'ownership[0].ownedThrough must be a date YYYY-MM-DD or "current"'],
    [owned({ ownedThrough: undefined }), 'ownership[0].ownedThrough must be a date YYYY-MM-DD or "current"'],
    [owned({ ownedThrough: '2019-12-31' }), 'ownership[0] ends (2019-12-31) before it starts (2020-01-01)'],
    [owned({ share: undefined }), 'ownership[0].share must be a percent above 0 and at most 100'],
    [owned({ share: 0 }), 'ownership[0].share must be a percent'],
    [owned({ share: 101 }), 'ownership[0].share must be a percent'],
    [owned({ share: '50' }), 'ownership[0].share must be a percent']
  ])('reports ownership entry %o, never guesses it', (entry, message) => {
    const { links, problems } = readLinks({ username: 'jane', ownership: [entry] });
    expect(links).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`jane: ${message}`);
  });

  test.each([
    [occupied({ roleName: 'tenant' }), 'occupies[0].roleName must be "occupant"'],
    [occupied({ roleName: undefined }), 'occupies[0].roleName must be "occupant"'],
    [occupied({ accommodation: '' }), 'occupies[0] has no accommodation'],
    [occupied({ startDate: '2020-1-1' }), 'occupies[0].startDate must be a date'],
    [occupied({ endDate: null }), 'occupies[0].endDate must be a date YYYY-MM-DD or "current"'],
    [occupied({ endDate: '2019-12-31' }), 'occupies[0] ends (2019-12-31) before it starts (2020-01-01)']
  ])('reports occupies entry %o, never guesses it', (entry, message) => {
    const { links, problems } = readLinks({ username: 'jane', occupies: [entry] });
    expect(links).toEqual([]);
    expect(problems).toEqual([expect.stringContaining(`jane: ${message}`)]);
  });

  test('an occupant entry carries no share, and one given is not read', () => {
    expect(readLinks({ username: 'u', occupies: [occupied({ share: 50 })] }).links).toEqual([
      { parcel: 'p', type: 'occupant', from: '2020-01-01', to: 'current' }
    ]);
  });

  test('a field that is not a list is reported', () => {
    expect(readLinks({ username: 'jane', ownership: 'p1', occupies: {} }).problems).toEqual([
      'jane: ownership is not a list',
      'jane: occupies is not a list'
    ]);
  });

  test('holdsOn: from and to are both days the link holds', () => {
    const link: UnitLink = { parcel: 'p', type: 'owner', from: '2020-01-01', to: '2020-12-31' };
    expect(holdsOn(link, '2019-12-31')).toBe(false);
    expect(holdsOn(link, '2020-01-01')).toBe(true);
    expect(holdsOn(link, '2020-12-31')).toBe(true);
    expect(holdsOn(link, '2021-01-01')).toBe(false);
    expect(holdsOn({ ...link, to: 'current' }, '2099-01-01')).toBe(true);
  });

  test('shareProblems: shares are checked on every date the owners change', () => {
    const o = (username: string, from: string, to: string, share: number) =>
      ({ username, link: { parcel: 'p', type: 'owner' as const, from, to, share } });
    // A sells to C on 2021-01-01; B keeps half throughout.
    expect(shareProblems([o('a', '2010-01-01', '2020-12-31', 50), o('b', '2010-01-01', 'current', 50), o('c', '2021-01-01', 'current', 50)])).toEqual([]);
    // C's share was written as 40: wrong from the sale on, right before it.
    expect(shareProblems([o('a', '2010-01-01', '2020-12-31', 50), o('b', '2010-01-01', 'current', 50), o('c', '2021-01-01', 'current', 40)])).toEqual([
      "unit p: owners' shares on 2021-01-01 add up to 90%, not 100% (b 50%, c 40%)"
    ]);
    // A gap with no owner is not a share problem; occupants are ignored.
    expect(shareProblems([o('a', '2010-01-01', '2010-12-31', 100), o('b', '2012-01-01', 'current', 100),
      { username: 'r', link: { parcel: 'p', type: 'occupant', from: '2010-06-01', to: 'current' } }])).toEqual([]);
  });

  test('dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(localToday(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
