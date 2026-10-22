/**
 * ResidencyManager — who owns and who lives in each unit, and since when.
 * Registered on the engine as 'ResidencyManager'.
 *
 * The links live on the ngdpbase user records, as condo's extended field
 * `condoUnits` (https://github.com/jwilleke/ngdpbase-addons/issues/15,
 * unitLinks.ts); this manager is their door. The units themselves, and the
 * owners' shares kept on each unit, are CondoUnitManager's.
 *
 * Users are read with the caller's context (a person's, or a job's with its
 * reason), so the read is attributed; the permission decision is made at the
 * door the person reached, a route or plugin (ngdpbase, 2026-10-21).
 */
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import type { CondoUnit } from '../providers/CondoUnitProvider.js';
import { holdsOn, isIsoDate, localToday, readLinks, type LinkType, type UnitLink } from './unitLinks.js';

/** A person on a unit: `username` is the ngdpbase account. */
export interface UnitMember { username: string; name: string; email: string | null }

/** An owner as billed: `share` is the percent of the assessment they pay. */
export interface UnitOwner extends UnitMember { share: number }

/** One link of a unit's history, with the person it names. */
export interface UnitHistoryEntry extends UnitMember { type: LinkType; from: string; to: string }

/** The fields condo reads from a user record (UserManager.searchUsers()). */
export interface CondoUserRecord {
  username: string;
  displayName?: string;
  email?: string;
  condoUnits?: unknown;
  [key: string]: unknown;
}

export interface ResidencyManagerOptions {
  /** Every user record, active or not, read as the caller (UserManager.searchUsers); absent means no users. */
  users?: (ctx: ActorContext) => Promise<CondoUserRecord[]>;
  /** A unit by its parcel: CondoUnitManager.get. */
  unit: (id: string) => CondoUnit | undefined;
  /** Today's date, YYYY-MM-DD; the server's local date unless a test gives one. */
  today?: () => string;
}

/** How a person is shown: their display name, else their username; their email when they have one. */
function memberOf(u: CondoUserRecord): UnitMember {
  return {
    username: u.username,
    name: typeof u.displayName === 'string' && u.displayName !== '' ? u.displayName : u.username,
    email: typeof u.email === 'string' && u.email !== '' ? u.email : null
  };
}

export default class ResidencyManager {
  private readonly users: (ctx: ActorContext) => Promise<CondoUserRecord[]>;
  private readonly unit: (id: string) => CondoUnit | undefined;
  private readonly today: () => string;

  constructor(options: ResidencyManagerOptions) {
    this.users = options.users ?? (() => Promise.resolve([]));
    this.unit = options.unit;
    this.today = options.today ?? (() => localToday());
  }

  /** Every well-formed link to the unit, with the person it names. Malformed links are left out (see linkProblems). */
  private async linksTo(ctx: ActorContext, id: string): Promise<Array<{ user: CondoUserRecord; link: UnitLink }>> {
    const found: Array<{ user: CondoUserRecord; link: UnitLink }> = [];
    for (const user of await this.users(ctx)) {
      for (const link of readLinks(user.username, user.condoUnits).links) {
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
   * A unit's owners on a date (today unless `on` is given), each with the share
   * of the assessment they are billed: the unit's `shares` by username, and
   * owners without one split what is left evenly. More than 100 given is
   * refused. `ctx` is the caller's: the person's, or a job's with its reason.
   */
  async owners(ctx: ActorContext, id: string, options: { on?: string } = {}): Promise<UnitOwner[]> {
    const owners = await this.members(ctx, id, 'owner', options.on);
    const shares = (this.unit(id)?.shares ?? {}) as Record<string, unknown>;
    const given = (o: UnitMember): number | null => {
      const s = shares[o.username];
      return typeof s === 'number' && Number.isFinite(s) ? s : null;
    };
    const total = owners.reduce((t, o) => t + (given(o) ?? 0), 0);
    if (total > 100) throw new Error(`unit ${id}: owners' shares add up to ${total}%, more than 100%`);
    const unshared = owners.filter(o => given(o) === null).length;
    const each = unshared ? (100 - total) / unshared : 0;
    return owners.map(o => ({ ...o, share: given(o) ?? each }));
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

  /** Every malformed link on any user record, each naming the user and the link; never guessed at. */
  async linkProblems(ctx: ActorContext): Promise<string[]> {
    return (await this.users(ctx)).flatMap(u => readLinks(u.username, u.condoUnits).problems);
  }
}
