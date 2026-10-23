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
 */
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import type { Accommodation } from '../providers/AccommodationProvider.js';
import { holdsOn, isIsoDate, localToday, readLinks, shareProblems, type LinkType, type UnitLink } from './unitLinks.js';
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

export interface ResidencyManagerOptions {
  /** Every user record, active or not, read as the caller (UserManager.searchUsers); absent means no users. */
  users?: (ctx: ActorContext) => Promise<UserRecord[]>;
  /** An accommodation by its parcel: AccommodationManager.get. */
  accommodation: (id: string) => Accommodation | undefined;
  /** Today's date, YYYY-MM-DD; the server's local date unless a test gives one. */
  today?: () => string;
}

/** How a person is shown: their display name, else their username; their email when they have one. */
function memberOf(u: UserRecord): UnitMember {
  return {
    username: u.username,
    name: typeof u.displayName === 'string' && u.displayName !== '' ? u.displayName : u.username,
    email: typeof u.email === 'string' && u.email !== '' ? u.email : null
  };
}

export default class ResidencyManager {
  private readonly users: (ctx: ActorContext) => Promise<UserRecord[]>;
  private readonly accommodation: (id: string) => Accommodation | undefined;
  private readonly today: () => string;

  constructor(options: ResidencyManagerOptions) {
    this.users = options.users ?? (() => Promise.resolve([]));
    this.accommodation = options.accommodation;
    this.today = options.today ?? (() => localToday());
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
