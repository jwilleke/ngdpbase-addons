import { describe, expect, test } from 'vitest';
import { holdsOn, isIsoDate, localToday, readLinks } from '../managers/unitLinks.js';

describe('unit links', () => {
  test('reads well-formed links', () => {
    expect(readLinks('u', [
      { parcel: 'p1', type: 'owner', from: '2012-05-01', to: '2020-08-31' },
      { parcel: 'p2', type: 'occupant', from: '2021-01-15', to: 'current' }
    ])).toEqual({
      links: [
        { parcel: 'p1', type: 'owner', from: '2012-05-01', to: '2020-08-31' },
        { parcel: 'p2', type: 'occupant', from: '2021-01-15', to: 'current' }
      ],
      problems: []
    });
    expect(readLinks('u', undefined)).toEqual({ links: [], problems: [] });
  });

  test.each([
    [{ type: 'owner', from: '2020-01-01', to: 'current' }, 'condoUnits[0] has no parcel'],
    [{ parcel: 'p', type: 'agent', from: '2020-01-01', to: 'current' }, '.type must be "owner" or "occupant"'],
    [{ parcel: 'p', type: 'owner', from: '01/02/2020', to: 'current' }, '.from must be a date'],
    [{ parcel: 'p', type: 'owner', from: '2020-02-30', to: 'current' }, '.from must be a date'],
    [{ parcel: 'p', type: 'owner', from: '2020-01-01', to: null }, '.to must be a date YYYY-MM-DD or "current"'],
    [{ parcel: 'p', type: 'owner', from: '2020-01-01' }, '.to must be a date YYYY-MM-DD or "current"'],
    [{ parcel: 'p', type: 'owner', from: '2020-01-01', to: '2019-12-31' }, 'ends (2019-12-31) before it starts (2020-01-01)']
  ])('reports %o, never guesses it', (link, message) => {
    const { links, problems } = readLinks('jane', [link]);
    expect(links).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('jane: condoUnits[0]');
    expect(problems[0]).toContain(message);
  });

  test('a field that is not a list is reported', () => {
    expect(readLinks('jane', 'p1').problems).toEqual(['jane: condoUnits is not a list']);
  });

  test('holdsOn: from and to are both days the link holds', () => {
    const link = { parcel: 'p', type: 'owner' as const, from: '2020-01-01', to: '2020-12-31' };
    expect(holdsOn(link, '2019-12-31')).toBe(false);
    expect(holdsOn(link, '2020-01-01')).toBe(true);
    expect(holdsOn(link, '2020-12-31')).toBe(true);
    expect(holdsOn(link, '2021-01-01')).toBe(false);
    expect(holdsOn({ ...link, to: 'current' }, '2099-01-01')).toBe(true);
  });

  test('dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(localToday(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
