/**
 * ResidencyManager — who owns and who lives in each accommodation, and since when.
 * Registered on the engine as 'ResidencyManager'.
 *
 * The links live on the ngdpbase user records, as the extended fields
 * `ownership` (OwnershipInfo) and `occupies` (Role)
 * (https://github.com/jwilleke/ngdpbase-addons/issues/21, unitLinks.ts); this
 * manager is their door. The accommodations themselves, and the billing parties kept on
 * each, are AccommodationManager's; billing() reads them with the owners
 * (https://github.com/jwilleke/ngdpbase-addons/issues/14).
 *
 * Users are read with the caller's context (a person's, or a job's with its
 * reason), so the read is attributed; the permission decision is made at the
 * door the person reached, a route or plugin (ngdpbase, 2026-10-21).
 *
 * Changes to the links go through changeLink (#28), the enforcement point: it asks the
 * decision point for `accommodation-manage` with the caller's context, refuses a malformed
 * entry with the reason, records `accommodation-manage` before it writes (on-failure refuse),
 * writes the one field through UserManager.updateUser as the caller, and then asks for the
 * roles job to run, as the caller, so the roles follow the new entries. The job is the one
 * place roles change (#23): it is retried, recorded and reported by the job manager, and it
 * keeps the add-on to its one call of the context-free RoleManager.hasRole (ngdpbase#2018).
 */
import type { ActorContext, AddonHost } from '@jwilleke/ngdpbase-types';
import type { Accommodation } from '../providers/AccommodationProvider.js';
import { AccommodationRefusedError, type AccommodationAuditRecord, type Decide } from './AccommodationManager.js';
import { fieldOf, holdsOn, isIsoDate, localToday, readEntries, readLinks, shareProblems, storedEntry, type LinkType, type UnitLink } from './unitLinks.js';
import { joinNames, readBillingParties, unitAddress, type PostalAddress } from './billing.js';

/** A person on a unit: `username` is the ngdpbase account. */
export interface UnitMember { username: string; name: string; email: string | null }

/** One invoice: the owners it is addressed to, where it goes, and the percent of the assessment. */
export interface BillingParty { to: UnitMember[]; name: string; address: PostalAddress; share: number }

/** One link of a unit's history, with the person it names. */
export interface UnitHistoryEntry extends UnitMember { type: LinkType; from: string; to: string }

/** The fields this add-on reads from a user record (UserManager.searchUsers()). */
export interface UserRecord {
  username: string;
  displayName?: string;
  email?: string;
  ownership?: unknown;
  occupies?: unknown;
  [key: string]: unknown;
}

/**
 * The ngdpbase roles the facts give (#23), through RoleManager: `holds` reads, `assign` and
 * `remove` change and record the change as the caller.
 */
export interface RoleDoor {
  holds(username: string, role: LinkType): Promise<boolean>;
  assign(username: string, role: LinkType, ctx: ActorContext): Promise<void>;
  remove(username: string, role: LinkType, ctx: ActorContext): Promise<void>;
}

/**
 * What one reconcile changed, the people it left alone because their entries could not be
 * read, and every change RoleManager refused, with its error.
 */
export interface RoleReconcileResult {
  assigned: Array<{ username: string; role: LinkType }>;
  removed: Array<{ username: string; role: LinkType }>;
  leftAlone: Array<{ username: string; role: LinkType }>;
  failed: Array<{ username: string; role: LinkType; change: 'assign' | 'remove'; error: string }>;
}

/** An entry as the page showed it: its type, its place in the list, and what it held then (JSON). */
export interface EntryRef { type: LinkType; index: number; expected: string }

/**
 * One change to a person's links (#28): add an entry, end a current one on a date, correct
 * one (a malformed one too: that is how it is fixed), or remove one entered by mistake.
 */
export type LinkChange =
  | { op: 'add'; link: UnitLink }
  | { op: 'end'; at: EntryRef; on: string }
  | { op: 'correct'; at: EntryRef; link: UnitLink }
  | { op: 'remove'; at: EntryRef };

/** A change refused before anything was written, with the reason an admin can act on. */
export class LinkChangeRefusedError extends Error {
  override readonly name = 'LinkChangeRefusedError';
}

/** Whether changeLink changed anything: a correction to what is already there changes nothing. */
export interface LinkChangeResult { changed: boolean }

/** Every entry naming one unit, with the person it is on, as the admin page shows it. */
export interface UnitEntry extends UnitMember { type: LinkType; index: number; expected: string; link?: UnitLink; problem?: string }

/** The write side (#28). Without it the manager only reads. */
export interface ResidencyChanges {
  /** ngdpbase's decision point. */
  decide: Decide;
  /** ngdpbase's recordAuditEvent for this add-on; throws when a refuse event cannot be written. */
  recordAudit: (record: AccommodationAuditRecord) => Promise<void>;
  /** ngdpbase's host: actorOf and the audit event names. */
  host: Pick<AddonHost, 'actorOf' | 'addonAuditEventName'>;
  /** UserManager.updateUser: writes the fields given onto the account, as the caller. */
  updateUser: (username: string, fields: Record<string, unknown>, ctx: ActorContext) => Promise<unknown>;
  /**
   * After a change is saved: start the roles job as the caller, so the roles follow it now
   * rather than at the next daily run. Absent, the daily run is when they follow. It must
   * not throw: a job that could not start is the job manager's to report.
   */
  followRoles?: (ctx: ActorContext) => Promise<void>;
}

export interface ResidencyManagerOptions {
  /** Every user record, active or not, read as the caller (UserManager.searchUsers); absent means no users. */
  users?: (ctx: ActorContext) => Promise<UserRecord[]>;
  /** An accommodation by its parcel: AccommodationManager.get. */
  accommodation: (id: string) => Accommodation | undefined;
  /** Today's date, YYYY-MM-DD; the server's local date unless a test gives one. */
  today?: () => string;
  changes?: ResidencyChanges;
}

/** How a person is shown: their display name, else their username; their email when they have one. */
function memberOf(u: UserRecord): UnitMember {
  return {
    username: u.username,
    name: typeof u.displayName === 'string' && u.displayName !== '' ? u.displayName : u.username,
    email: typeof u.email === 'string' && u.email !== '' ? u.email : null
  };
}

/** The unit a stored entry names, read or not; undefined when it names none. */
function parcelOf(raw: unknown, type: LinkType): string | undefined {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[type === 'owner' ? 'typeOfGood' : 'accommodation'] : undefined;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The names of the fields `entry` gives a different value from `raw`, sorted. */
function changedKeys(raw: unknown, entry: Record<string, unknown>): string[] {
  const before = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.keys(entry).filter(k => JSON.stringify(before[k]) !== JSON.stringify(entry[k])).sort();
}

export default class ResidencyManager {
  private readonly users: (ctx: ActorContext) => Promise<UserRecord[]>;
  private readonly accommodation: (id: string) => Accommodation | undefined;
  private readonly today: () => string;
  private readonly changes: ResidencyChanges | undefined;

  constructor(options: ResidencyManagerOptions) {
    this.users = options.users ?? (() => Promise.resolve([]));
    this.accommodation = options.accommodation;
    this.today = options.today ?? (() => localToday());
    this.changes = options.changes;
  }

  /** Every well-formed link to the unit, with the person it names. Malformed links are left out (see linkProblems). */
  private async linksTo(ctx: ActorContext, id: string): Promise<Array<{ user: UserRecord; link: UnitLink }>> {
    const found: Array<{ user: UserRecord; link: UnitLink }> = [];
    for (const user of await this.users(ctx)) {
      for (const link of readLinks(user).links) {
        if (link.parcel === id) found.push({ user, link });
      }
    }
    return found;
  }

  /** The people with a link of that type holding on the date, ordered by username. */
  private async members(ctx: ActorContext, id: string, type: LinkType, on?: string): Promise<UnitMember[]> {
    const date = on ?? this.today();
    if (!isIsoDate(date)) throw new Error(`not a date YYYY-MM-DD: ${date}`);
    const seen = new Map<string, UnitMember>();
    for (const { user, link } of await this.linksTo(ctx, id)) {
      if (link.type === type && holdsOn(link, date)) seen.set(user.username, memberOf(user));
    }
    return [...seen.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  /**
   * A unit's owners on a date (today unless `on` is given), ordered by
   * username. `ctx` is the caller's: the person's, or a job's with its reason.
   */
  async owners(ctx: ActorContext, id: string, options: { on?: string } = {}): Promise<UnitMember[]> {
    return this.members(ctx, id, 'owner', options.on);
  }

  /**
   * Who gets the unit's invoices on a date (today unless `on` is given): one
   * party per billing address, each with its owners, address and share. With
   * no parties kept on the unit, one party: every current owner at the unit's
   * own address, 100%. Throws, naming the unit, rather than bill wrongly: a
   * party naming someone who is not a current owner, shares that do not add
   * up to 100, no owners, or no address.
   */
  async billing(ctx: ActorContext, id: string, options: { on?: string } = {}): Promise<BillingParty[]> {
    const owners = await this.owners(ctx, id, options);
    if (owners.length === 0) throw new Error(`unit ${id}: no current owner to bill`);
    const byName = new Map(owners.map(o => [o.username, o]));
    const accommodation = this.accommodation(id);
    const stored = readBillingParties(id, accommodation?.billing);
    const parties = stored ?? (() => {
      const address = unitAddress(accommodation);
      if (!address) throw new Error(`unit ${id}: no billing parties and no unit address to bill`);
      return [{ to: owners.map(o => o.username), address, share: 100 }];
    })();
    return parties.map((p, i) => {
      const to = p.to.map(username => {
        const owner = byName.get(username);
        if (!owner) throw new Error(`unit ${id}: billing[${i}] names ${username}, who is not a current owner`);
        return owner;
      });
      return { to, name: joinNames(to.map(o => o.name)), address: p.address, share: p.share };
    });
  }

  /** The people living in the unit on a date (today unless `on` is given); never billed. */
  async occupants(ctx: ActorContext, id: string, options: { on?: string } = {}): Promise<UnitMember[]> {
    return this.members(ctx, id, 'occupant', options.on);
  }

  /** Every owner and occupant the unit has had, past and present, oldest first. */
  async history(ctx: ActorContext, id: string): Promise<UnitHistoryEntry[]> {
    return (await this.linksTo(ctx, id))
      .map(({ user, link }) => ({ ...memberOf(user), type: link.type, from: link.from, to: link.to }))
      .sort((a, b) => a.from.localeCompare(b.from) || a.username.localeCompare(b.username) || a.type.localeCompare(b.type));
  }

  /**
   * The units among `ids` with no owner on a date (today unless `on` is given), worked out
   * from the dated links whenever asked: nothing is stored or scheduled (operator, 2026-10-23).
   */
  async withoutOwner(ctx: ActorContext, ids: string[], options: { on?: string } = {}): Promise<string[]> {
    const date = options.on ?? this.today();
    if (!isIsoDate(date)) throw new Error(`not a date YYYY-MM-DD: ${date}`);
    const owned = new Set<string>();
    for (const user of await this.users(ctx)) {
      for (const link of readLinks(user).links) {
        if (link.type === 'owner' && holdsOn(link, date)) owned.add(link.parcel);
      }
    }
    return ids.filter(id => !owned.has(id));
  }

  /**
   * Make the `owner` and `occupant` roles follow the facts (#23): a person holds `owner`
   * while any of their ownership entries is current today, and `occupant` while any of
   * their occupancy entries is; otherwise they lose it. A role is never taken away while
   * any of that person's entries for it cannot be read: it is left as it is, never guessed
   * (linkProblems names the entry).
   * Each change goes through `roles` as the caller, which records it. A change RoleManager
   * refuses (it throws on any failure, ngdpbase#2015) is listed in `failed` with its error,
   * and the rest still run, so one person's problem never holds up everyone else's roles.
   */
  async reconcileRoles(ctx: ActorContext, roles: RoleDoor): Promise<RoleReconcileResult> {
    const today = this.today();
    const result: RoleReconcileResult = { assigned: [], removed: [], leftAlone: [], failed: [] };
    const users = [...await this.users(ctx)].sort((a, b) => a.username.localeCompare(b.username));
    for (const user of users) {
      const { links, unreadable } = readLinks(user);
      for (const role of ['owner', 'occupant'] as const) {
        const should = links.some(l => l.type === role && holdsOn(l, today));
        const has = await roles.holds(user.username, role);
        if (should === has) continue;
        if (!should && unreadable.includes(role)) { result.leftAlone.push({ username: user.username, role }); continue; }
        const change = should ? 'assign' : 'remove';
        try {
          await roles[change](user.username, role, ctx);
          (should ? result.assigned : result.removed).push({ username: user.username, role });
        } catch (err) {
          result.failed.push({ username: user.username, role, change, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    return result;
  }

  /** Every account, by username, as the add-on's pages offer them: display name and email. */
  async people(ctx: ActorContext): Promise<UnitMember[]> {
    return (await this.users(ctx)).map(memberOf).sort((a, b) => a.username.localeCompare(b.username));
  }

  /** Each unit's owners and occupants on a date (today unless `on` is given), from one read of the users. */
  async roster(ctx: ActorContext, ids: string[], options: { on?: string } = {}): Promise<Map<string, { owners: UnitMember[]; occupants: UnitMember[] }>> {
    const date = options.on ?? this.today();
    if (!isIsoDate(date)) throw new Error(`not a date YYYY-MM-DD: ${date}`);
    const roster = new Map(ids.map(id => [id, { owners: [] as UnitMember[], occupants: [] as UnitMember[] }]));
    const users = [...await this.users(ctx)].sort((a, b) => a.username.localeCompare(b.username));
    for (const user of users) {
      for (const link of readLinks(user).links) {
        const unit = roster.get(link.parcel);
        if (!unit || !holdsOn(link, date)) continue;
        const list = link.type === 'owner' ? unit.owners : unit.occupants;
        if (!list.some(m => m.username === user.username)) list.push(memberOf(user));
      }
    }
    return roster;
  }

  /**
   * Every entry naming the unit, read or not, oldest first, each with what the admin page needs
   * to change it (#28), and every date the unit's owners' shares do not add up to 100. An entry
   * too broken to name a unit is not here; linkProblems names it.
   */
  async unitEntries(ctx: ActorContext, id: string): Promise<{ entries: UnitEntry[]; shareProblems: string[] }> {
    const entries: UnitEntry[] = [];
    for (const user of await this.users(ctx)) {
      for (const e of readEntries(user).entries) {
        if ((e.link?.parcel ?? parcelOf(e.raw, e.type)) !== id) continue;
        entries.push({ ...memberOf(user), type: e.type, index: e.index, expected: JSON.stringify(e.raw), link: e.link, problem: e.problem });
      }
    }
    entries.sort((a, b) => (a.link?.from ?? '').localeCompare(b.link?.from ?? '') || a.username.localeCompare(b.username) || a.type.localeCompare(b.type));
    const owners = entries.flatMap(e => (e.link?.type === 'owner' ? [{ username: e.username, link: e.link }] : []));
    return { entries, shareProblems: shareProblems(owners) };
  }

  /**
   * Why an entry with these values would be refused, or null: the checks changeLink makes
   * (a known accommodation, real dates, an end not before the start), the owner's share
   * aside. For a form that takes the entry now and adds it later, after review (#32).
   */
  checkEntry(entry: { parcel: string; type: LinkType; from: string; to: string }): string | null {
    if (!this.accommodation(entry.parcel)) return `no accommodation ${entry.parcel}`;
    const stored = storedEntry(entry.type === 'owner' ? { ...entry, share: 100 } : entry);
    return 'problem' in stored ? stored.problem : null;
  }

  /**
   * Make one change to a person's links (#28), as the caller. Refused, with nothing written:
   * without `accommodation-manage` (AccommodationRefusedError, for ApiContext.enforceDeny);
   * a person or accommodation that does not exist, a malformed entry, or an entry that changed
   * since the page showed it (LinkChangeRefusedError, naming why). Recorded as
   * `accommodation-manage` before it is written, naming the fields changed, never their
   * values; a write that then fails is recorded as a failure and thrown. Then the roles job
   * is started as the caller (followRoles).
   */
  async changeLink(ctx: ActorContext, username: string, change: LinkChange): Promise<LinkChangeResult> {
    const changes = this.changes;
    if (!changes) throw new Error('ResidencyManager was started without its write side');
    const decision = await changes.decide(ctx, { action: 'accommodation-manage' });
    if (!decision.permit) throw new AccommodationRefusedError('accommodation-manage', decision);

    const user = (await this.users(ctx)).find(u => u.username === username);
    if (!user) throw new LinkChangeRefusedError(`no account named ${username}`);
    const type = change.op === 'add' || change.op === 'correct' ? change.link.type : change.at.type;
    const field = fieldOf(type);
    const current = user[field];
    if (current !== undefined && !Array.isArray(current)) throw new LinkChangeRefusedError(`${username}: ${field} is not a list; it has to be fixed on the account first`);
    const list: unknown[] = [...(current ?? [])];

    const planned = this.plan(username, field, list, change);
    if (!planned) return { changed: false };

    const { metadata: whoMetadata, ...who } = changes.host.actorOf(ctx);
    const record = (result: 'success' | 'failure', reason?: string): AccommodationAuditRecord => ({
      eventType: changes.host.addonAuditEventName('accommodation-manage'),
      ...who,
      result,
      action: `${type}-${change.op}`, severity: 'medium', resource: planned.parcel, resourceType: 'accommodation',
      metadata: { ...whoMetadata, username, owner: username, field, fields: planned.fields, ...(reason ? { reason } : {}) }
    });
    // on-failure refuse: no record, no change.
    await changes.recordAudit(record('success'));
    try {
      await changes.updateUser(username, { [field]: planned.next }, ctx);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await changes.recordAudit(record('failure', reason)).catch(() => undefined);
      throw err;
    }

    await changes.followRoles?.(ctx);
    return { changed: true };
  }

  /**
   * The list after the change, the unit it is about and the names of the fields it changes;
   * null when a correction changes nothing. Throws LinkChangeRefusedError with the reason.
   */
  private plan(username: string, field: string, list: unknown[], change: LinkChange): { next: unknown[]; parcel: string; fields: string[] } | null {
    const known = (parcel: string): void => {
      if (!this.accommodation(parcel)) throw new LinkChangeRefusedError(`no accommodation ${parcel}`);
    };
    const stored = (link: UnitLink): Record<string, unknown> => {
      const s = storedEntry(link);
      if ('problem' in s) throw new LinkChangeRefusedError(s.problem);
      return s.entry;
    };
    if (change.op === 'add') {
      known(change.link.parcel);
      const entry = stored(change.link);
      return { next: [...list, entry], parcel: change.link.parcel, fields: Object.keys(entry).sort() };
    }

    const { index, expected } = change.at;
    if (!Number.isInteger(index) || index < 0 || index >= list.length || JSON.stringify(list[index]) !== expected) {
      throw new LinkChangeRefusedError(`${username}: ${field}[${index}] has changed since the page was shown; reload it and try again`);
    }
    const raw = list[index];
    const was = readEntries({ username, [field]: [raw] }).entries[0];
    const parcel = was?.link?.parcel ?? parcelOf(raw, change.at.type) ?? '';

    if (change.op === 'remove') {
      return { next: list.filter((_, i) => i !== index), parcel, fields: [] };
    }
    if (change.op === 'end') {
      if (!was?.link) throw new LinkChangeRefusedError(`${username}: ${field}[${index}] cannot be read (${was?.problem ?? 'unknown'}); correct it instead`);
      if (was.link.to !== 'current') throw new LinkChangeRefusedError(`${username}: ${field}[${index}] already ended on ${was.link.to}; correct it instead`);
      const entry = stored({ ...was.link, to: change.on });
      return { next: list.map((e, i) => (i === index ? { ...(raw as object), ...entry } : e)), parcel, fields: changedKeys(raw, entry) };
    }
    known(change.link.parcel);
    const entry = stored(change.link);
    const fields = changedKeys(raw, entry);
    if (fields.length === 0) return null;
    return { next: list.map((e, i) => (i === index ? { ...(raw as object), ...entry } : e)), parcel: change.link.parcel, fields };
  }

  /**
   * Every malformed link on any user record, each naming the user and the entry, then every
   * date a unit's owners' shares do not add up to 100; never guessed at.
   */
  async linkProblems(ctx: ActorContext): Promise<string[]> {
    const read = (await this.users(ctx)).map(u => ({ username: u.username, ...readLinks(u) }));
    return [
      ...read.flatMap(r => r.problems),
      ...shareProblems(read.flatMap(r => r.links.map(link => ({ username: r.username, link }))))
    ];
  }
}
