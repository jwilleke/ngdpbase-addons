/**
 * Billing parties: one invoice per billing address, kept on the unit
 * (operator, 2026-10-22, https://github.com/jwilleke/ngdpbase-addons/issues/14).
 *
 *   "billing": [
 *     { "to": ["jim.willeke", "molly.willeke"], "address": { "streetAddress": "…", … }, "share": 100 }
 *   ]
 *
 * A unit without `billing` has one party: all its current owners, at the
 * unit's own address, for 100%. Shares add up to exactly 100.
 */
import type { Accommodation } from '../providers/AccommodationProvider.js';

/** schema.org PostalAddress, as ngdpbase contacts keep it. */
export interface PostalAddress {
  streetAddress: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
}

/** A billing party as stored on the unit. */
export interface StoredBillingParty { to: string[]; address: PostalAddress; share: number }

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** A PostalAddress from a value, or null when it has no street. */
export function readAddress(value: unknown): PostalAddress | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Record<string, unknown>;
  const streetAddress = text(a.streetAddress);
  if (!streetAddress) return null;
  const out: PostalAddress = { streetAddress };
  for (const k of ['addressLocality', 'addressRegion', 'postalCode'] as const) {
    if (text(a[k])) out[k] = text(a[k]);
  }
  return out;
}

/**
 * The unit's own address: its `address` field, else The Fairways' county
 * fields (streetNo, streetName, streetType, city, state, zip); null when it has neither.
 */
export function unitAddress(unit: Accommodation | undefined): PostalAddress | null {
  if (!unit) return null;
  const own = readAddress(unit.address);
  if (own) return own;
  const street = [text(unit.streetNo), text(unit.streetName), text(unit.streetType)].filter(Boolean).join(' ');
  if (!street) return null;
  return readAddress({ streetAddress: street, addressLocality: unit.city, addressRegion: unit.state, postalCode: unit.zip });
}

/**
 * The parties stored on the unit, checked. Throws, naming the unit, for
 * anything that would bill the wrong people or the wrong amount: a party with
 * nobody, no address or no share, or shares that do not add up to 100.
 * Undefined means the unit keeps no parties (the default applies).
 */
export function readBillingParties(unitId: string, value: unknown): StoredBillingParty[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new Error(`unit ${unitId}: billing must be a list of billing parties`);
  const parties = value.map((raw, i) => {
    const where = `unit ${unitId}: billing[${i}]`;
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const to = Array.isArray(p.to) ? p.to.filter((u): u is string => typeof u === 'string' && u !== '') : [];
    if (to.length === 0) throw new Error(`${where}.to must name at least one owner`);
    const address = readAddress(p.address);
    if (!address) throw new Error(`${where}.address must have a streetAddress`);
    if (typeof p.share !== 'number' || !Number.isFinite(p.share) || p.share <= 0) throw new Error(`${where}.share must be a percent above 0`);
    return { to, address, share: p.share };
  });
  const total = parties.reduce((t, p) => t + p.share, 0);
  if (Math.abs(total - 100) > 1e-9) throw new Error(`unit ${unitId}: billing shares add up to ${total}%, not 100%`);
  return parties;
}

/** The names on one invoice as one line: "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
