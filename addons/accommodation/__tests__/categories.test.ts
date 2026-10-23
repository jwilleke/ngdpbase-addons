import { describe, expect, test } from 'vitest';
import { categoriesFrom } from '../managers/categories.js';
import { FAIRWAYS_CATEGORIES } from './fixtures.js';

describe('categoriesFrom', () => {
  test('reads the Fairways example categories', () => {
    const categories = categoriesFrom(FAIRWAYS_CATEGORIES);
    expect(categories.size).toBe(8);
    expect(categories.get('D')).toEqual({ id: 'D', name: 'D Model', assessment: 58400, period: 'monthly', datedue: 1 });
  });

  test('nothing configured is no categories', () => {
    expect(categoriesFrom(undefined).size).toBe(0);
    expect(categoriesFrom({}).size).toBe(0);
  });

  test('an annual category is due on a month and day', () => {
    expect(categoriesFrom({ X: { assessment: 120000, period: 'annual', datedue: '02-29' } }).get('X')).toMatchObject({ name: 'X', datedue: '02-29' });
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
    expect(() => categoriesFrom({ C: entry })).toThrow(`ngdpbase.addons.accommodation.categories.C.`);
    expect(() => categoriesFrom({ C: entry })).toThrow(message);
  });

  test('refuses a list', () => {
    expect(() => categoriesFrom([])).toThrow('must be a map');
  });
});
