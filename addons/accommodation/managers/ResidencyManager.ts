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
 * writes the one field through UserManager.updateUser's function form as the caller (one step
 * from read to write per account, ngdpbase#2025), and then asks for the
 * roles job to run, as the caller, so the roles follow the new entries. The job is the one
 * place roles change (#23): it is retried, recorded and reported by the job manager, and it
 * keeps the add-on to its one call of the context-free RoleManager.hasRole (ngdpbase#2018).
 */
import type { ActorContext, AddonHost } from '@jwilleke/ngdpbase-types';
import type { Accommodation } from '../providers/AccommodationProvider.js';
import { AccommodationRefusedError, type AccommodationAuditRecord, type Decide } from './AccommodationManager.js';
import { fieldOf, holdsOn, isIsoDate, localToday, readEntries, readLinks, shareProblems, storedEntry, type LinkType, type UnitLink } from './unitLinks.js';
import { contactDetailsFrom, occupantAnswersFrom, OCCUPANT_EDITABLE_FIELDS, OCCUPANT_EDITABLE_TYPES } from './contactDetails.js';
import { joinNames, readAddress, readBillingParties, unitAddress, type PostalAddress, type StoredBillingParty } from './billing.js';

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
  holds(ctx: ActorContext, username: string, role: LinkType): Promise<boolean>;
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

/**
 * Whether changeLink changed anything (a correction to what is already there changes nothing),
 * and for an added entry where it is, so a caller can end or remove it later (#33's undo).
 */
export interface LinkChangeResult { changed: boolean; at?: EntryRef }

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
  /**
   * UserManager.updateUser's function form, as the caller: `update` gets the account as it is now,
   * inside the account's own key, and returns the fields to write, or undefined for none.
   */
  updateUser: (username: string, update: (current: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>, ctx: ActorContext) => Promise<unknown>;
  /**
   * AccommodationManager's write of the unit's billing parties, under the system context with a
   * reason naming the owner (#38); the owner's own decision and record come first, in this manager.
   */
  writeBilling?: (systemCtx: ActorContext, id: string, billing: StoredBillingParty[]) => Promise<void>;
  /** Tell the holders of `accommodation-notices` (#38). Must not throw. */
  notify?: (title: string, message: string) => Promise<void>;
  /**
   * After a change is saved: start the roles job as the caller, so the roles follow it now
   * rather than at the next daily run. Absent, the daily run is when they follow. It must
   * not throw: a job that could not start is the job manager's to report.
   */
  followRoles?: (ctx: ActorContext) => Promise<void>;
}

/**
 * One of a resident's own units (#36), as their page shows it: only what the viewer may see.
 * Co-owners' and occupants' names; occupants' emails and the billing parties only to an owner.
 */
export interface OwnUnit {
  id: string;
  /** How the viewer holds it today: owner, occupant, or both. */
  as: LinkType[];
  owners: Array<{ name: string }>;
  /** To an owner, each occupant's entry too, so the owner can end it (#37). */
  occupants: Array<{ name: string; email?: string; entry?: { username: string; at: EntryRef }; details?: Record<string, string> }>;
  /** The unit's billing parties, each with its place and whether the viewer is on it (#38). */
  billing?: Array<{ index: number; name: string; address: PostalAddress; share: number; yours: boolean }>;
}

/** core's IdentityManager, under the system context once a door has decided (#37). */
export interface IdentityDoor {
  /** The user's own identity record: its id and contactPoint entries; null when there is none. */
  find: (systemCtx: ActorContext, username: string) => Promise<{ id: string; contactPoint?: unknown[] } | null>;
  update: (systemCtx: ActorContext, id: string, patch: Record<string, unknown>) => Promise<unknown>;
}

export interface ResidencyManagerOptions {
  /** core's IdentityManager: occupants' contact details for an owner (#37). */
  identities?: IdentityDoor;
  /** ngdpbase's decision point, for a resident's own reads (#36). */
  decide?: Decide;
  /** host.systemContext: the reads a resident's page needs, made once the door has decided (#36). */
  systemContext?: (reason: string) => ActorContext;
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
  private readonly decide: Decide | undefined;
  private readonly identities: IdentityDoor | undefined;
  private readonly systemContext: ((reason: string) => ActorContext) | undefined;

  constructor(options: ResidencyManagerOptions) {
    this.decide = options.decide;
    this.identities = options.identities;
    this.systemContext = options.systemContext;
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
   *
   * The door for anyone outside this manager, accounting's invoice job included: it decides
   * `accommodation-billing-read` with the caller's context, then reads the owners it needs under
   * the system context with a reason naming the caller and unit, and returns only billing fields
   * (asked by ngdpbase core for accounting, 2026-10-25). A job with no roles needs no search-user.
   */
  async billing(ctx: ActorContext, id: string, options: { on?: string } = {}): Promise<BillingParty[]> {
    if (!this.decide || !this.systemContext) throw new Error('ResidencyManager was started without its decision point');
    const decision = await this.decide(ctx, { action: 'accommodation-billing-read' });
    if (!decision.permit) throw new AccommodationRefusedError('accommodation-billing-read', decision);
    return this.billingOf(this.systemContext(`accommodation: billing parties of unit ${id}, for ${ctx.username ?? 'unknown'}`), id, options);
  }

  /** billing() once the door has decided: read as the context given (the system's). */
  private async billingOf(ctx: ActorContext, id: string, options: { on?: string } = {}): Promise<BillingParty[]> {
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
        const has = await roles.holds(ctx, user.username, role);
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
   * The units the caller holds a current ownership or occupies entry for, today (#36). The door
   * decides first, with the caller's context: `accommodation-self`, which every user holds through
   * vault-owner, and then the caller's own current entries, which are the only units returned.
   * Only then are the other people read, under the system context with a reason naming the caller
   * (settled with ngdpbase core, 2026-10-25), and only the fields the viewer may see are returned.
   */
  async ownUnits(ctx: ActorContext): Promise<OwnUnit[]> {
    if (!this.decide || !this.systemContext) throw new Error('ResidencyManager was started without its decision point');
    const decision = await this.decide(ctx, { action: 'accommodation-self' });
    if (!decision.permit) throw new AccommodationRefusedError('accommodation-self', decision);
    const me = ctx.username;
    if (!me) return [];
    const system = this.systemContext(`accommodation: own units and their residents, for ${me}`);
    const users = [...await this.users(system)].sort((a, b) => a.username.localeCompare(b.username));
    const self = users.find(u => u.username === me);
    if (!self) return [];
    const today = this.today();
    const held = readLinks(self).links.filter(l => holdsOn(l, today));
    const ids = [...new Set(held.map(l => l.parcel))].sort();
    const result: OwnUnit[] = [];
    for (const id of ids) {
      const as = (['owner', 'occupant'] as const).filter(t => held.some(l => l.parcel === id && l.type === t));
      const holding = (type: LinkType): UnitMember[] => users
        .filter(u => readLinks(u).links.some(l => l.parcel === id && l.type === type && holdsOn(l, today)))
        .map(memberOf);
      const isOwner = as.includes('owner');
      const unit: OwnUnit = {
        id, as,
        owners: holding('owner').map(o => ({ name: o.name })),
        occupants: users.flatMap(u => readEntries(u).entries
          .filter(e => e.link && e.link.parcel === id && e.link.type === 'occupant' && holdsOn(e.link, today))
          .map(e => {
            const o = memberOf(u);
            return {
              name: o.name,
              ...(isOwner && o.email ? { email: o.email } : {}),
              ...(isOwner ? { entry: { username: u.username, at: { type: 'occupant' as const, index: e.index, expected: JSON.stringify(e.raw) } } } : {})
            };
          }))
      };
      if (isOwner && this.identities) {
        // An owner sees the occupants' contact details, to change them (#37).
        for (const o of unit.occupants) {
          if (!o.entry) continue;
          const person = await this.identities.find(system, o.entry.username);
          o.details = occupantAnswersFrom(person?.contactPoint);
        }
      }
      if (isOwner) {
        // Billing parties the unit cannot bill yet (no address, shares off) are left out, not guessed.
        unit.billing = await this.billingOf(system, id).then(parties => parties.map((p, index) =>
          ({ index, name: p.name, address: p.address, share: p.share, yours: p.to.some(o => o.username === me) })), () => undefined);
      }
      result.push(unit);
    }
    return result;
  }

  /**
   * An owner sets the address of a billing party they are on (#38; operator, 2026-10-22: it
   * applies at once, with a notice to the Board of Directors). The door decides with the owner's
   * context: `accommodation-self`, a current owner of the unit, on that party. A unit that keeps no
   * parties has one, all its current owners; setting its address keeps that party. Recorded as
   * `accommodation-billing-update` under the owner's context first (on-failure refuse), then
   * written by AccommodationManager under the system context with a reason naming the owner, then
   * the holders of `accommodation-notices` are told.
   */
  async setBillingAddress(ctx: ActorContext, id: string, partyIndex: number, value: unknown): Promise<void> {
    const changes = this.changes;
    if (!changes?.writeBilling || !this.decide || !this.systemContext) throw new Error('ResidencyManager was started without its billing door');
    const decision = await this.decide(ctx, { action: 'accommodation-self' });
    if (!decision.permit) throw new AccommodationRefusedError('accommodation-self', decision);
    const me = ctx.username ?? '';
    const accommodation = this.accommodation(id);
    if (!accommodation) throw new LinkChangeRefusedError(`no accommodation ${id}`);
    const system = this.systemContext(`accommodation: billing address of unit ${id}, set by its owner ${me}`);
    const owners = await this.owners(system, id);
    if (!owners.some(o => o.username === me)) throw new LinkChangeRefusedError(`you are not a current owner of unit ${id}`);
    const address = readAddress(value);
    if (!address) throw new LinkChangeRefusedError('a billing address needs a street address');

    let parties: StoredBillingParty[];
    try {
      parties = readBillingParties(id, accommodation.billing)
        ?? [{ to: owners.map(o => o.username), address: unitAddress(accommodation) ?? address, share: 100 }];
    } catch (err) {
      throw new LinkChangeRefusedError(`the unit's billing parties need fixing by an administrator first: ${err instanceof Error ? err.message : String(err)}`);
    }
    const party = parties[partyIndex];
    if (!Number.isInteger(partyIndex) || !party) throw new LinkChangeRefusedError(`unit ${id} has no billing party ${partyIndex}`);
    if (!party.to.includes(me)) throw new LinkChangeRefusedError(`you are not on billing party ${partyIndex} of unit ${id}`);
    const next = parties.map((p, i) => (i === partyIndex ? { ...p, address } : p));

    const { metadata: whoMetadata, ...who } = changes.host.actorOf(ctx);
    const record = (result: 'success' | 'failure', reason?: string): AccommodationAuditRecord => ({
      eventType: changes.host.addonAuditEventName('accommodation-billing-update'),
      ...who, result,
      action: 'billing-address-set', severity: 'medium', resource: id, resourceType: 'accommodation',
      // names, never values
      metadata: { ...whoMetadata, party: partyIndex, fields: Object.keys(address).sort(), ...(reason ? { reason } : {}) }
    });
    await changes.recordAudit(record('success'));
    try {
      await changes.writeBilling(system, id, next);
    } catch (err) {
      await changes.recordAudit(record('failure', err instanceof Error ? err.message : String(err))).catch(() => undefined);
      throw err;
    }
    await changes.notify?.('Billing address changed', `An owner of unit ${id} changed the address of its billing party ${partyIndex + 1}.`);
  }

  /** The Occupancy information form's answers as identity-record fields: the one mapping (contactDetails.ts). */
  contactDetails(answers: Record<string, unknown>): ReturnType<typeof contactDetailsFrom> {
    return contactDetailsFrom(answers);
  }

  /**
   * An owner changes their occupant's phones, work details and emergency contact (#37; operator,
   * 2026-10-22: it applies at once, with a notice to the reviewers). The door decides with the
   * owner's context: `accommodation-self`, the caller a current owner of the unit, the person a
   * current occupant of it, and only those fields; never the occupant's name, email or home
   * address. Recorded as `accommodation-occupant-update` under the owner first (on-failure refuse;
   * names, never values), then the occupant's identity record is written by core's IdentityManager
   * under the system context with a reason naming the owner, unit and occupant (settled with
   * ngdpbase core, 2026-10-25), then the holders of `accommodation-notices` are told. The kinds an
   * owner may change are replaced as given; a blank answer clears that kind, and other kinds stay.
   */
  async updateOccupantDetails(ctx: ActorContext, id: string, occupant: string, answers: Record<string, unknown>): Promise<void> {
    const changes = this.changes;
    if (!changes || !this.identities || !this.decide || !this.systemContext) throw new Error('ResidencyManager was started without its identity door');
    const decision = await this.decide(ctx, { action: 'accommodation-self' });
    if (!decision.permit) throw new AccommodationRefusedError('accommodation-self', decision);
    const me = ctx.username ?? '';
    if (!this.accommodation(id)) throw new LinkChangeRefusedError(`no accommodation ${id}`);
    const system = this.systemContext(`accommodation: ${me}, an owner of unit ${id}, changes the contact details of its occupant ${occupant}`);
    if (!(await this.owners(system, id)).some(o => o.username === me)) throw new LinkChangeRefusedError(`you are not a current owner of unit ${id}`);
    const target = (await this.occupants(system, id)).find(o => o.username === occupant);
    if (!target) throw new LinkChangeRefusedError(`${occupant} is not a current occupant of unit ${id}`);
    const unknown = Object.keys(answers).filter(k => !(OCCUPANT_EDITABLE_FIELDS as readonly string[]).includes(k));
    if (unknown.length > 0) throw new LinkChangeRefusedError(`an owner may not change ${unknown.sort().join(', ')}`);
    const person = await this.identities.find(system, occupant);
    if (!person) throw new LinkChangeRefusedError(`${occupant} has no identity record to hold the details`);

    const given = contactDetailsFrom(Object.fromEntries(OCCUPANT_EDITABLE_FIELDS.map(f => [f, answers[f] ?? ''])));
    const editable = new Set<string>(OCCUPANT_EDITABLE_TYPES);
    const kept = (person.contactPoint ?? []).filter(c => !editable.has(String((c as Record<string, unknown>)['contactType'])));
    const answered = OCCUPANT_EDITABLE_FIELDS.filter(f => typeof answers[f] === 'string' && (answers[f] as string).trim() !== '');

    const { metadata: whoMetadata, ...who } = changes.host.actorOf(ctx);
    const record = (result: 'success' | 'failure', reason?: string): AccommodationAuditRecord => ({
      eventType: changes.host.addonAuditEventName('accommodation-occupant-update'),
      ...who, result,
      action: 'occupant-details-set', severity: 'medium', resource: id, resourceType: 'accommodation',
      // names, never values
      metadata: { ...whoMetadata, occupant, owner: occupant, fields: [...answered], ...(reason ? { reason } : {}) }
    });
    await changes.recordAudit(record('success'));
    try {
      await this.identities.update(system, person.id, { contactPoint: [...kept, ...given.contactPoint] });
    } catch (err) {
      await changes.recordAudit(record('failure', err instanceof Error ? err.message : String(err))).catch(() => undefined);
      throw err;
    }
    await changes.notify?.('Occupant details changed by an owner', `An owner of unit ${id} changed an occupant's contact details.`);
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
   *
   * Without `accommodation-manage`, a current owner of a unit may end an occupant's entry on that
   * unit (#37; settled with ngdpbase core, 2026-10-25): `accommodation-self`, the caller a current
   * owner of the entry's unit, an occupies entry, and `end` only; never an owner's entry. It is
   * recorded the same way, and the holders of `accommodation-notices` are told.
   */
  async changeLink(ctx: ActorContext, username: string, change: LinkChange): Promise<LinkChangeResult> {
    const changes = this.changes;
    if (!changes) throw new Error('ResidencyManager was started without its write side');
    const decision = await changes.decide(ctx, { action: 'accommodation-manage' });
    const byOwner = !decision.permit && await this.ownerMayEnd(ctx, username, change);
    if (!decision.permit && !byOwner) throw new AccommodationRefusedError('accommodation-manage', decision);

    if (!(await this.users(ctx)).some(u => u.username === username)) throw new LinkChangeRefusedError(`no account named ${username}`);
    const type = change.op === 'add' || change.op === 'correct' ? change.link.type : change.at.type;
    const field = fieldOf(type);
    const { metadata: whoMetadata, ...who } = changes.host.actorOf(ctx);
    let planned: { next: unknown[]; parcel: string; fields: string[] } | null = null;
    const record = (result: 'success' | 'failure', reason?: string): AccommodationAuditRecord => ({
      eventType: changes.host.addonAuditEventName('accommodation-manage'),
      ...who,
      result,
      action: `${type}-${change.op}`, severity: 'medium', resource: planned?.parcel ?? '', resourceType: 'accommodation',
      metadata: { ...whoMetadata, username, owner: username, field, fields: planned?.fields ?? [], ...(reason ? { reason } : {}) }
    });

    // One step from read to write (ngdpbase#2025, 5.28.0): the list is read from the account as it
    // is now, inside its own key, so a change made at the same moment is never lost. A refusal or a
    // record that cannot be written throws inside, and nothing is written.
    let recorded = false;
    try {
      await changes.updateUser(username, async (current) => {
        const value = current[field];
        if (value !== undefined && !Array.isArray(value)) throw new LinkChangeRefusedError(`${username}: ${field} is not a list; it has to be fixed on the account first`);
        planned = this.plan(username, field, [...(value ?? [])], change);
        if (!planned) return undefined;
        // on-failure refuse: no record, no change.
        await changes.recordAudit(record('success'));
        recorded = true;
        return { [field]: planned.next };
      }, ctx);
    } catch (err) {
      if (recorded) await changes.recordAudit(record('failure', err instanceof Error ? err.message : String(err))).catch(() => undefined);
      throw err;
    }
    const done = planned as { next: unknown[] } | null;
    if (!done) return { changed: false };

    await changes.followRoles?.(ctx);
    if (byOwner) {
      await changes.notify?.('Occupant ended by an owner', `An owner of unit ${(planned as { parcel: string } | null)?.parcel ?? ''} ended an occupant's entry.`);
    }
    if (change.op !== 'add') return { changed: true };
    const index = done.next.length - 1;
    return { changed: true, at: { type, index, expected: JSON.stringify(done.next[index]) } };
  }

  /**
   * Whether the caller may end this occupant's entry as an owner of its unit (#37): an `end` of an
   * occupies entry, `accommodation-self`, and a current ownership entry on the entry's unit. The
   * entry is read here to find its unit; the write then checks it has not changed since.
   */
  private async ownerMayEnd(ctx: ActorContext, username: string, change: LinkChange): Promise<boolean> {
    if (change.op !== 'end' || change.at.type !== 'occupant' || !this.decide || !this.systemContext || !ctx.username) return false;
    const self = await this.decide(ctx, { action: 'accommodation-self' });
    if (!self.permit) return false;
    const system = this.systemContext(`accommodation: whether ${ctx.username} owns the unit of ${username}'s occupancy`);
    const target = (await this.users(system)).find(u => u.username === username);
    const entry = target ? readEntries(target).entries.find(e => e.type === 'occupant' && e.index === change.at.index) : undefined;
    if (!entry?.link || JSON.stringify(entry.raw) !== change.at.expected) return false;
    return (await this.owners(system, entry.link.parcel)).some(o => o.username === ctx.username);
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
