import { describe, expect, test } from 'vitest';
import { lateChargesFrom } from '../managers/lateCharges.js';
import { FAIRWAYS_LATE_CHARGES } from './fixtures.js';

describe('lateChargesFrom', () => {
  test('reads the Fairways example rules, ordered by days late', () => {
    expect(lateChargesFrom(FAIRWAYS_LATE_CHARGES)).toEqual([
      { id: 'late-10', daysLate: 10, amount: 1000, annualPercent: null, repeat: 'once' },
      { id: 'late-60', daysLate: 60, amount: 5000, annualPercent: 8, repeat: 'monthly' }
    ]);
  });

  test('nothing configured is no rules', () => {
    expect(lateChargesFrom(undefined)).toEqual([]);
    expect(lateChargesFrom({})).toEqual([]);
  });

  test('interest alone is a rule', () => {
    expect(lateChargesFrom({ i: { 'days-late': 30, 'annual-percent': 12, repeat: 'monthly' } })[0]).toMatchObject({ amount: null, annualPercent: 12 });
  });

  test.each([
    [{ 'days-late': 0, amount: 1000, repeat: 'once' }, 'days-late must be whole days'],
    [{ 'days-late': 10.5, amount: 1000, repeat: 'once' }, 'days-late must be whole days'],
    [{ 'days-late': 10, amount: 10.5, repeat: 'once' }, 'amount must be whole cents'],
    [{ 'days-late': 10, 'annual-percent': 0, repeat: 'monthly' }, 'annual-percent must be'],
    [{ 'days-late': 10, 'annual-percent': '8', repeat: 'monthly' }, 'annual-percent must be'],
    [{ 'days-late': 10, repeat: 'once' }, 'needs an amount, an annual-percent, or both'],
    [{ 'days-late': 10, amount: 1000, repeat: 'weekly' }, 'repeat must be']
  ])('refuses %o', (entry, message) => {
    expect(() => lateChargesFrom({ r: entry })).toThrow('ngdpbase.addons.accommodation.late-charges.r');
    expect(() => lateChargesFrom({ r: entry })).toThrow(message);
  });

  test('refuses a list', () => {
    expect(() => lateChargesFrom([])).toThrow('must be a map');
  });
});
