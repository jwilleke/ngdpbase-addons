import { describe, expect, test } from 'vitest';
import { joinNames, unitAddress } from '../managers/billing.js';

describe('billing helpers', () => {
  test('the unit address: its own address field first, else The Fairways county fields', () => {
    expect(unitAddress({ id: 'p', address: { streetAddress: '1 Main St', postalCode: '43050' } })).toEqual({ streetAddress: '1 Main St', postalCode: '43050' });
    expect(unitAddress({ id: 'p', streetNo: '21', streetName: 'Fairway', streetType: 'Dr', city: 'Mount Vernon', state: 'OH', zip: '43050' }))
      .toEqual({ streetAddress: '21 Fairway Dr', addressLocality: 'Mount Vernon', addressRegion: 'OH', postalCode: '43050' });
    expect(unitAddress({ id: 'p' })).toBeNull();
    expect(unitAddress(undefined)).toBeNull();
  });

  test('names on one invoice', () => {
    expect(joinNames(['Jim Willeke'])).toBe('Jim Willeke');
    expect(joinNames(['Jim Willeke', 'Molly Willeke'])).toBe('Jim Willeke and Molly Willeke');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
