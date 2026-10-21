import { describe, expect, test } from 'vitest';
import { unitTypesFrom } from '../managers/unitTypes.js';
import { FAIRWAYS_UNIT_TYPES } from './fixtures.js';

describe('unitTypesFrom', () => {
  test('reads the Fairways example types', () => {
    const types = unitTypesFrom(FAIRWAYS_UNIT_TYPES);
    expect(types.size).toBe(8);
    expect(types.get('D')).toEqual({ id: 'D', name: 'D Model', assessment: 58400, period: 'monthly', datedue: 1 });
  });

  test('nothing configured is no types', () => {
    expect(unitTypesFrom(undefined).size).toBe(0);
    expect(unitTypesFrom({}).size).toBe(0);
  });

  test('an annual type is due on a month and day', () => {
    expect(unitTypesFrom({ X: { assessment: 120000, period: 'annual', datedue: '02-29' } }).get('X')).toMatchObject({ name: 'X', datedue: '02-29' });
  });

  test.each([
    [{ assessment: 410.5, period: 'monthly', datedue: 1 }, 'assessment must be whole cents'],
    [{ assessment: -1, period: 'monthly', datedue: 1 }, 'assessment must be whole cents'],
    [{ assessment: 41000, period: 'weekly', datedue: 1 }, 'period must be'],
    [{ assessment: 41000, period: 'monthly', datedue: 31 }, 'a day of the month, 1–28'],
    [{ assessment: 41000, period: 'monthly', datedue: '01' }, 'a day of the month, 1–28'],
    [{ assessment: 41000, period: 'annual', datedue: '02-30' }, 'a date "MM-DD"'],
    [{ assessment: 41000, period: 'annual', datedue: 15 }, 'a date "MM-DD"']
  ])('refuses %o', (entry, message) => {
    expect(() => unitTypesFrom({ C: entry })).toThrow(`ngdpbase.addons.condo.unit-types.C.`);
    expect(() => unitTypesFrom({ C: entry })).toThrow(message);
  });

  test('refuses a list', () => {
    expect(() => unitTypesFrom([])).toThrow('must be a map');
  });
});
