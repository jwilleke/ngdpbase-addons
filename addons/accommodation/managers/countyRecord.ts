/**
 * The county's record of a unit (operator, 2026-10-25,
 * https://github.com/jwilleke/ngdpbase-addons/issues/41): who the county says owns it and where
 * it sends their mail, as read from the county on a date. Kept on the accommodation beside our own
 * entries, never in place of them.
 *
 *   "countyRecord": {
 *     "ownerName": "…", "attention": "…", "mailingAddress": { "streetAddress": "…", … },
 *     "lastSaleDate": "2025-08-18", "source": "…", "readOn": "2026-10-24"
 *   }
 */
import type { Accommodation } from '../providers/AccommodationProvider.js';
import { readAddress, type PostalAddress } from './billing.js';

export interface CountyRecord {
  ownerName: string;
  /** The county's attention line, when it keeps one. */
  attention?: string;
  mailingAddress: PostalAddress;
  /** ISO date of the newest transfer the county records. */
  lastSaleDate: string;
  source: string;
  /** ISO date the record was read from the county. */
  readOn: string;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The unit's county record, or null when it has none or it lacks an owner or address. */
export function countyRecordOf(unit: Accommodation | undefined): CountyRecord | null {
  const raw = unit?.countyRecord;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mailingAddress = readAddress(r.mailingAddress);
  if (!text(r.ownerName) || !mailingAddress) return null;
  return {
    ownerName: text(r.ownerName),
    ...(text(r.attention) ? { attention: text(r.attention) } : {}),
    mailingAddress,
    lastSaleDate: text(r.lastSaleDate),
    source: text(r.source),
    readOn: text(r.readOn)
  };
}
