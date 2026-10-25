/**
 * Where a unit's invoices are sent (operator, 2026-10-25, ngdpbase#2042): a list of billing
 * entries kept on the unit, each a free-form address, typed by the treasurer or an owner, and that
 * entry's share of the invoice.
 *
 *   "billing": [
 *     { "address": "MOLLY E WILLEKE & JAMES S WILLEKE\n123 Main St\nAkron OH 44333", "share": 100 }
 *   ]
 *
 * Who owes is never here: it is the unit's owners on the invoice date (ResidencyManager.billing).
 * Shares add up to exactly 100; a single entry's share may be left out and is then 100. Every unit
 * must have at least one entry (operator, 2026-10-25): there is no default address.
 */
import type { Accommodation } from '../providers/AccommodationProvider.js';

/** schema.org PostalAddress, as ngdpbase contacts keep it. */
export interface PostalAddress {
  streetAddress: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
}

/** One billing entry: where an invoice goes, and its share. */
export interface BillingEntry { address: string; share: number }

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

/** A PostalAddress as the lines of a billing address: the street, then "City ST ZIP". */
export function addressText(a: PostalAddress): string {
  const last = [a.addressLocality, [a.addressRegion, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  return [a.streetAddress, last].filter(Boolean).join('\n');
}

/** Whether a stored billing list is the earlier shape: entries naming owners (`to`) or a structured address. */
export function isLegacyBilling(value: unknown): boolean {
  return Array.isArray(value) && value.some(raw => !!raw && typeof raw === 'object'
    && ('to' in raw || typeof (raw as Record<string, unknown>).address === 'object'));
}

/**
 * The billing entries stored on the unit, checked. Throws, naming the unit, for anything that would
 * send an invoice nowhere or bill the wrong amount: an entry with no address, a share that is not a
 * percent above 0, shares that do not add up to 100, or the earlier shape not yet converted.
 * Undefined means the unit has none yet, which billing() refuses.
 */
export function readBilling(unitId: string, value: unknown): BillingEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new Error(`unit ${unitId}: billing must be a list of billing entries`);
  if (isLegacyBilling(value)) throw new Error(`unit ${unitId}: billing is in the earlier shape and has not been converted`);
  const entries = value.map((raw, i) => {
    const where = `unit ${unitId}: billing entry ${i + 1}`;
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const address = typeof e.address === 'string' ? e.address.trim() : '';
    if (!address) throw new Error(`${where} has no address`);
    const share = e.share === undefined && value.length === 1 ? 100 : e.share;
    if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0) throw new Error(`${where}: the share must be a percent above 0`);
    return { address, share };
  });
  const total = entries.reduce((t, e) => t + e.share, 0);
  if (Math.abs(total - 100) > 1e-9) throw new Error(`unit ${unitId}: billing shares add up to ${total}%, not 100%`);
  return entries;
}

/**
 * The earlier shape's entries as billing entries, once (ngdpbase#2042): each entry's owners' names,
 * joined with " & ", above its address lines. `nameOf` gives an account's display name, undefined
 * for a username with no account; any such username is returned in `missing` and nothing is
 * converted, so the unit is left as it is.
 */
export function convertLegacyBilling(value: unknown[], nameOf: (username: string) => string | undefined):
  { billing: Array<{ address: string; share: unknown }> } | { missing: string[] } {
  const missing: string[] = [];
  const billing = value.map(raw => {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const to = Array.isArray(e.to) ? e.to.filter((u): u is string => typeof u === 'string' && u !== '') : [];
    const names = to.map(u => nameOf(u) ?? (missing.push(u), u));
    const postal = readAddress(e.address);
    const lines = postal ? addressText(postal) : typeof e.address === 'string' ? e.address.trim() : '';
    return { address: [names.join(' & '), lines].filter(Boolean).join('\n'), share: e.share };
  });
  return missing.length > 0 ? { missing: [...new Set(missing)].sort() } : { billing };
}

/** The billing entries as a form shows them, with what is wrong with them, if anything. */
export interface BillingForm {
  entries: Array<{ address: string; share: string }>;
  /** True when the unit has none yet and `entries` is only a suggestion, not saved. */
  suggested: boolean;
  problem?: string;
}

/**
 * The billing entries as a form shows them: as stored, else `suggestion` at 100%, marked suggested
 * and unsaved, with what is wrong with them, if anything, so it can be fixed there.
 */
export function billingForForm(unit: Accommodation | undefined, suggestion?: string): BillingForm {
  const stored = unit?.billing;
  if (stored === undefined) {
    return { entries: suggestion ? [{ address: suggestion, share: '100' }] : [], suggested: true,
      problem: 'this unit has no billing address yet, so no invoice can be sent; save one' };
  }
  let problem: string | undefined;
  try { readBilling(unit?.id ?? '', stored); } catch (err) { problem = err instanceof Error ? err.message : String(err); }
  const entries = (Array.isArray(stored) ? stored : []).map(raw => {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return { address: typeof e.address === 'string' ? e.address : '', share: typeof e.share === 'number' ? String(e.share) : '' };
  });
  return { entries, suggested: false, ...(problem ? { problem } : {}) };
}
