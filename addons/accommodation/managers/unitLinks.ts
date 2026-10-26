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
 *
 * An ownership entry also names its ownership period, `period` (operator, 2026-10-26, #43): one
 * stretch of the same owners with the same shares, which accounting bills as one folio. A unit's
 * period is the entries that share the id. A correction keeps it; a real change of owners or shares
 * ends the entries and adds new ones under a new id.
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
  /** An owner's ownership period id (#43); absent on an occupant, and on an entry not yet given one. */
  period?: string;
}

/** The fields this module reads from a user record. */
export interface LinkFields {
  username: string;
  ownership?: unknown;
  occupies?: unknown;
}

/**
 * One entry of a user's `ownership` or `occupies` list, by its place in the list, as stored
 * (`raw`): the link it reads as, or the problem that stops it being one.
 */
export interface LinkEntry {
  type: LinkType;
  index: number;
  raw: unknown;
  link?: UnitLink;
  problem?: string;
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
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The day before an ISO date. */
export function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
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
const SHAPES: Record<LinkType, FieldShape> = { owner: OWNERSHIP, occupant: OCCUPIES };

/** The user-record field that holds a link type's entries. */
export function fieldOf(type: LinkType): 'ownership' | 'occupies' {
  return SHAPES[type].field;
}

/** One stored entry as a link, or the problem that stops it being one; `where` names it in the problem. */
function readEntry(raw: unknown, shape: FieldShape, where: string): { link: UnitLink } | { problem: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const parcel = r[shape.parcel];
  const from = r[shape.from];
  const to = r[shape.to];
  if (shape.type === 'occupant' && r.roleName !== 'occupant') return { problem: `${where}.roleName must be "occupant"` };
  if (typeof parcel !== 'string' || parcel === '') return { problem: `${where} has no ${shape.parcel}` };
  if (!isIsoDate(from)) return { problem: `${where}.${shape.from} must be a date YYYY-MM-DD` };
  if (to !== 'current' && !isIsoDate(to)) return { problem: `${where}.${shape.to} must be a date YYYY-MM-DD or "current"` };
  if (to !== 'current' && to < from) return { problem: `${where} ends (${to}) before it starts (${from})` };
  if (shape.type === 'occupant') return { link: { parcel, type: 'occupant', from, to } };
  const share = r.share;
  if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0 || share > 100) {
    return { problem: `${where}.share must be a percent above 0 and at most 100` };
  }
  const period = r.period;
  if (period !== undefined && (typeof period !== 'string' || period === '')) return { problem: `${where}.period must name an ownership period` };
  return { link: { parcel, type: 'owner', from, to, share, ...(period ? { period } : {}) } };
}

/** One field's entries, each read on its own; a field that is not a list is one problem for the whole field. */
function readField(username: string, value: unknown, shape: FieldShape): { entries: LinkEntry[]; fieldProblem?: string } {
  if (value === undefined) return { entries: [] };
  if (!Array.isArray(value)) return { entries: [], fieldProblem: `${username}: ${shape.field} is not a list` };
  return {
    entries: value.map((raw, index) => ({ type: shape.type, index, raw, ...readEntry(raw, shape, `${username}: ${shape.field}[${index}]`) }))
  };
}

/**
 * Every entry of a user's two fields, read or not, in field order then list order; `problems`
 * names a field that is not a list at all. What readLinks and the change doors build on.
 */
export function readEntries(user: LinkFields): { entries: LinkEntry[]; problems: string[] } {
  const read = [OWNERSHIP, OCCUPIES].map(shape => readField(user.username, user[shape.field], shape));
  return {
    entries: read.flatMap(r => r.entries),
    problems: read.flatMap(r => (r.fieldProblem ? [r.fieldProblem] : []))
  };
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
  for (const shape of [OWNERSHIP, OCCUPIES]) {
    const { entries, fieldProblem } = readField(user.username, user[shape.field], shape);
    const found = [...(fieldProblem ? [fieldProblem] : []), ...entries.flatMap(e => (e.problem ? [e.problem] : []))];
    links.push(...entries.flatMap(e => (e.link ? [e.link] : [])));
    problems.push(...found);
    if (found.length > 0) unreadable.push(shape.type);
  }
  return { links, problems, unreadable };
}

/**
 * A link as it is stored on the user record (unitLinks' header): `ownership` as OwnershipInfo,
 * `occupies` as Role. The stored shape is checked by readEntry, so what is written reads back
 * as the same link or is refused with the reason.
 */
export function storedEntry(link: UnitLink): { entry: Record<string, unknown> } | { problem: string } {
  const shape = SHAPES[link.type];
  const entry: Record<string, unknown> = link.type === 'owner'
    ? { [shape.parcel]: link.parcel, [shape.from]: link.from, [shape.to]: link.to, share: link.share, ...(link.period ? { period: link.period } : {}) }
    : { roleName: 'occupant', [shape.parcel]: link.parcel, [shape.from]: link.from, [shape.to]: link.to };
  const read = readEntry(entry, shape, shape.field);
  return 'problem' in read ? { problem: read.problem } : { entry };
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

/**
 * Every date on which a unit's owners are not in one ownership period (#43): owners holding on the
 * same day under different period ids, or with none. One problem per date the owners change, as
 * shareProblems does. A unit with no owner that day has none.
 */
export function periodProblems(owners: Array<{ username: string; link: UnitLink }>): string[] {
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
      const ids = new Set(holding.map(e => e.link.period ?? ''));
      if (holding.length === 0 || (ids.size === 1 && !ids.has(''))) continue;
      problems.push(ids.has('')
        ? `unit ${parcel}: on ${date} ${holding.filter(e => !e.link.period).map(e => e.username).sort().join(', ')} ${holding.filter(e => !e.link.period).length === 1 ? 'is' : 'are'} in no ownership period`
        : `unit ${parcel}: owners on ${date} are in ${ids.size} ownership periods, not one`);
    }
  }
  return problems;
}
