import { describe, expect, it } from 'vitest';
import { countyRecordOf, suggestedBilling } from '../managers/countyRecord.js';

const record = {
  ownerName: 'DOE JANE', mailingAddress: { streetAddress: '1 Main St', addressLocality: 'Columbus', addressRegion: 'OH', postalCode: '43215', addressCountry: 'USA' },
  lastSaleDate: '2025-08-18', source: 'county extract', readOn: '2026-10-24'
};

describe('countyRecordOf', () => {
  it('reads the record kept on the unit', () => {
    expect(countyRecordOf({ id: 'u1', countyRecord: { ...record, attention: 'C/O BANK' } })).toEqual({
      ownerName: 'DOE JANE', attention: 'C/O BANK',
      mailingAddress: { streetAddress: '1 Main St', addressLocality: 'Columbus', addressRegion: 'OH', postalCode: '43215' },
      lastSaleDate: '2025-08-18', source: 'county extract', readOn: '2026-10-24'
    });
  });

  it('is null without a record, an owner or a mailing street', () => {
    expect(countyRecordOf({ id: 'u1' })).toBeNull();
    expect(countyRecordOf(undefined)).toBeNull();
    expect(countyRecordOf({ id: 'u1', countyRecord: { ...record, ownerName: ' ' } })).toBeNull();
    expect(countyRecordOf({ id: 'u1', countyRecord: { ...record, mailingAddress: { addressLocality: 'Columbus' } } })).toBeNull();
  });

  it("suggests a first billing address: the county's owner and mailing address, else the unit's own", () => {
    expect(suggestedBilling({ id: 'u1', countyRecord: { ...record, attention: 'C/O BANK' } })).toBe('DOE JANE\nC/O BANK\n1 Main St\nColumbus OH 43215');
    expect(suggestedBilling({ id: 'u1', address: { streetAddress: '13 Fairway Dr', addressLocality: 'Mount Vernon' } })).toBe('13 Fairway Dr\nMount Vernon');
    expect(suggestedBilling({ id: 'u1' })).toBeUndefined();
  });
});
