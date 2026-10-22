/**
 * Dated owner and occupant links, kept on the ngdpbase user record as condo's
 * extended field `condoUnits` (https://github.com/jwilleke/ngdpbase-addons/issues/15):
 *
 *   "condoUnits": [
 *     { "parcel": "66-00001.000", "type": "owner",    "from": "2012-05-01", "to": "2020-08-31" },
 *     { "parcel": "66-00002.000", "type": "occupant", "from": "2021-01-15", "to": "current" }
 *   ]
 *
 * `to` is an ISO date or the word "current", never null (operator, 2026-10-22).
 * A link that is not exactly this shape is reported, never guessed.
 */

export type LinkType = 'owner' | 'occupant';

export interface UnitLink {
  parcel: string;
  type: LinkType;
  /** ISO date, YYYY-MM-DD. */
  from: string;
  /** ISO date, or "current". */
  to: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Today's date where the server runs, YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A user's links, and what is wrong with any that are not links. Each problem
 * names the user and the link's position, so an admin can find it.
 */
export function readLinks(username: string, value: unknown): { links: UnitLink[]; problems: string[] } {
  const links: UnitLink[] = [];
  const problems: string[] = [];
  if (value === undefined) return { links, problems };
  if (!Array.isArray(value)) return { links, problems: [`${username}: condoUnits is not a list`] };
  value.forEach((raw, i) => {
    const where = `${username}: condoUnits[${i}]`;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (typeof r.parcel !== 'string' || r.parcel === '') { problems.push(`${where} has no parcel`); return; }
    if (r.type !== 'owner' && r.type !== 'occupant') { problems.push(`${where}.type must be "owner" or "occupant"`); return; }
    if (!isIsoDate(r.from)) { problems.push(`${where}.from must be a date YYYY-MM-DD`); return; }
    if (r.to !== 'current' && !isIsoDate(r.to)) { problems.push(`${where}.to must be a date YYYY-MM-DD or "current"`); return; }
    if (r.to !== 'current' && (r.to as string) < r.from) { problems.push(`${where} ends (${String(r.to)}) before it starts (${r.from})`); return; }
    links.push({ parcel: r.parcel, type: r.type, from: r.from, to: r.to as string });
  });
  return { links, problems };
}

/** Whether the link holds on that date: started on or before it, and current or ended on or after it. */
export function holdsOn(link: UnitLink, date: string): boolean {
  return link.from <= date && (link.to === 'current' || link.to >= date);
}
