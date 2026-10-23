/**
 * Dated owner and occupant links, kept on the ngdpbase user record as two extended
 * fields in schema.org shapes (https://github.com/jwilleke/ngdpbase-addons/issues/21):
 *
 *   "ownership": [
 *     { "typeOfGood": "66-00001.000", "ownedFrom": "2012-05-01", "ownedThrough": "2020-08-31", "share": 100 }
 *   ],
 *   "occupies": [
 *     { "roleName": "occupant", "accommodation": "66-00002.000", "startDate": "2021-01-15", "endDate": "current" }
 *   ]
 *
 * `ownership` entries are OwnershipInfo: `typeOfGood` is the accommodation's parcel, and
 * `share` is the owner's percent of it (joint owners' votes); on any date a unit's current
 * owners add up to exactly 100. `occupies` entries are Role: `roleName` is "occupant" (agent
 * and tenant later), `accommodation` the parcel (operator, 2026-10-23). An end is an ISO date
 * or the word "current", never null (operator, 2026-10-22). An entry that is not exactly this
 * shape is reported, never guessed.
 */

export type LinkType = 'owner' | 'occupant';

/** One link, whichever field it came from. */
export interface UnitLink {
  parcel: string;
  type: LinkType;
  /** ISO date, YYYY-MM-DD. */
  from: string;
  /** ISO date, or "current". */
  to: string;
  /** An owner's percent of the unit; absent for an occupant. */
  share?: number;
}

/** The fields this module reads from a user record. */
export interface LinkFields {
  username: string;
  ownership?: unknown;
  occupies?: unknown;
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

/** The day after an ISO date. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** How one field's entries are read: its name, its link type, and the names of its parts. */
interface FieldShape {
  field: 'ownership' | 'occupies';
  type: LinkType;
  parcel: string;
  from: string;
  to: string;
}

const OWNERSHIP: FieldShape = { field: 'ownership', type: 'owner', parcel: 'typeOfGood', from: 'ownedFrom', to: 'ownedThrough' };
const OCCUPIES: FieldShape = { field: 'occupies', type: 'occupant', parcel: 'accommodation', from: 'startDate', to: 'endDate' };

/** Reads one field's entries into `links`, and returns how many problems it added. */
function readField(username: string, value: unknown, shape: FieldShape, links: UnitLink[], problems: string[]): number {
  const before = problems.length;
  if (value === undefined) return 0;
  if (!Array.isArray(value)) { problems.push(`${username}: ${shape.field} is not a list`); return 1; }
  value.forEach((raw, i) => {
    const where = `${username}: ${shape.field}[${i}]`;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const parcel = r[shape.parcel];
    const from = r[shape.from];
    const to = r[shape.to];
    if (shape.type === 'occupant' && r.roleName !== 'occupant') { problems.push(`${where}.roleName must be "occupant"`); return; }
    if (typeof parcel !== 'string' || parcel === '') { problems.push(`${where} has no ${shape.parcel}`); return; }
    if (!isIsoDate(from)) { problems.push(`${where}.${shape.from} must be a date YYYY-MM-DD`); return; }
    if (to !== 'current' && !isIsoDate(to)) { problems.push(`${where}.${shape.to} must be a date YYYY-MM-DD or "current"`); return; }
    if (to !== 'current' && to < from) { problems.push(`${where} ends (${to}) before it starts (${from})`); return; }
    if (shape.type === 'owner') {
      const share = r.share;
      if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0 || share > 100) {
        problems.push(`${where}.share must be a percent above 0 and at most 100`); return;
      }
      links.push({ parcel, type: 'owner', from, to, share });
      return;
    }
    links.push({ parcel, type: 'occupant', from, to });
  });
  return problems.length - before;
}

/**
 * A user's links, and what is wrong with any entries that are not links. Each problem
 * names the user, the field and the entry's position, so an admin can find it.
 * `unreadable` names the link types with at least one problem, so a caller can leave
 * alone what it cannot read.
 */
export function readLinks(user: LinkFields): { links: UnitLink[]; problems: string[]; unreadable: LinkType[] } {
  const links: UnitLink[] = [];
  const problems: string[] = [];
  const unreadable: LinkType[] = [];
  if (readField(user.username, user.ownership, OWNERSHIP, links, problems) > 0) unreadable.push('owner');
  if (readField(user.username, user.occupies, OCCUPIES, links, problems) > 0) unreadable.push('occupant');
  return { links, problems, unreadable };
}

/** Whether the link holds on that date: started on or before it, and current or ended on or after it. */
export function holdsOn(link: UnitLink, date: string): boolean {
  return link.from <= date && (link.to === 'current' || link.to >= date);
}

/**
 * Every date on which a unit's current owners' shares do not add up to 100, one problem per
 * date the owners change. Dates with no owner at all are not share problems.
 */
export function shareProblems(owners: Array<{ username: string; link: UnitLink }>): string[] {
  const byParcel = new Map<string, Array<{ username: string; link: UnitLink }>>();
  for (const o of owners) {
    if (o.link.type !== 'owner') continue;
    byParcel.set(o.link.parcel, [...(byParcel.get(o.link.parcel) ?? []), o]);
  }
  const problems: string[] = [];
  for (const [parcel, entries] of [...byParcel].sort(([a], [b]) => a.localeCompare(b))) {
    const changes = new Set<string>();
    for (const { link } of entries) {
      changes.add(link.from);
      if (link.to !== 'current') changes.add(nextDay(link.to));
    }
    for (const date of [...changes].sort()) {
      const holding = entries.filter(e => holdsOn(e.link, date));
      if (holding.length === 0) continue;
      const total = holding.reduce((t, e) => t + (e.link.share ?? 0), 0);
      if (Math.abs(total - 100) > 1e-9) {
        const who = holding.map(e => `${e.username} ${e.link.share}%`).sort().join(', ');
        problems.push(`unit ${parcel}: owners' shares on ${date} add up to ${total}%, not 100% (${who})`);
      }
    }
  }
  return problems;
}
