import { describe, expect, test } from 'vitest';
import { addressText, billingForForm, convertLegacyBilling, isLegacyBilling, unitAddress } from '../managers/billing.js';

describe('billing helpers', () => {
  test('the unit address: its own address field first, else The Fairways county fields', () => {
    expect(unitAddress({ id: 'p', address: { streetAddress: '1 Main St', postalCode: '43050' } })).toEqual({ streetAddress: '1 Main St', postalCode: '43050' });
    expect(unitAddress({ id: 'p', streetNo: '21', streetName: 'Fairway', streetType: 'Dr', city: 'Mount Vernon', state: 'OH', zip: '43050' }))
      .toEqual({ streetAddress: '21 Fairway Dr', addressLocality: 'Mount Vernon', addressRegion: 'OH', postalCode: '43050' });
    expect(unitAddress({ id: 'p' })).toBeNull();
    expect(unitAddress(undefined)).toBeNull();
  });

  test('an address as billing lines: the street, then city, state and ZIP', () => {
    expect(addressText({ streetAddress: '123 Main St', addressLocality: 'Akron', addressRegion: 'OH', postalCode: '44333' })).toBe('123 Main St\nAkron OH 44333');
    expect(addressText({ streetAddress: '123 Main St' })).toBe('123 Main St');
  });

  test('the earlier shape converts once: the owners\' names, joined with &, above the address lines', () => {
    const legacy = [{ to: ['molly', 'jim'], address: { streetAddress: '123 Main St', addressLocality: 'Akron', addressRegion: 'OH', postalCode: '44333' }, share: 100 }];
    expect(isLegacyBilling(legacy)).toBe(true);
    expect(isLegacyBilling([{ address: 'A', share: 100 }])).toBe(false);
    const names: Record<string, string> = { molly: 'MOLLY E WILLEKE', jim: 'JAMES S WILLEKE' };
    expect(convertLegacyBilling(legacy, u => names[u])).toEqual({ billing: [{ address: 'MOLLY E WILLEKE & JAMES S WILLEKE\n123 Main St\nAkron OH 44333', share: 100 }] });
  });

  test('a username with no account converts nothing: it is reported, never kept as a name', () => {
    const legacy = [{ to: ['molly', 'gone.user'], address: { streetAddress: '1 A St' }, share: 100 }];
    expect(convertLegacyBilling(legacy, u => (u === 'molly' ? 'Molly' : undefined))).toEqual({ missing: ['gone.user'] });
  });

  test('a form shows the entries as stored, else the unit address at 100%, with what is wrong', () => {
    expect(billingForForm({ id: 'p', address: { streetAddress: '1 Main St' } })).toEqual({ entries: [{ address: '1 Main St', share: '100' }], usesUnitAddress: true });
    expect(billingForForm({ id: 'p', billing: [{ address: 'A', share: 60 }] }))
      .toEqual({ entries: [{ address: 'A', share: '60' }], usesUnitAddress: false, problem: 'unit p: billing shares add up to 60%, not 100%' });
  });
});
