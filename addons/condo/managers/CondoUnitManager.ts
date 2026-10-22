/**
 * CondoUnitManager — the one door to condo units, registered on the engine as
 * 'CondoUnitManager' so routes, plugins and other add-ons reach it with
 * engine.getManager('CondoUnitManager').
 *
 * Units are read and written through a provider chosen by config
 * (`ngdpbase.addons.condo.provider`, default `json`); nothing else touches the
 * store. A unit's `id` is its county parcel; every other field it was given is
 * kept and passed through (https://github.com/jwilleke/ngdpbase-addons/issues/4).
 * The manager names the generic ones: `unitType`, `shares`, `notes`.
 *
 * Who owns or occupies a unit is kept on the user records, not the unit
 * (https://github.com/jwilleke/ngdpbase-addons/issues/11): condo's extended
 * fields `parcel` (the parcels the user belongs to) and `condoUserType`
 * (`owner`, `occupant` or both). The unit keeps only `shares`, by username.
 * Users are read with the caller's context (a person's, or a job's with its
 * reason), so the read is attributed; the permission decision is made at the
 * door the person reached, a route or plugin (ngdpbase, 2026-10-21).
 *
 * Every write goes through write(), which saves and then bumps the
 * 'CondoUnitManager' cache topic, so pages showing units re-render.
 *
 * The manager is the enforcement point for changes to units
 * (https://github.com/jwilleke/ngdpbase-addons/issues/5): upsert and delete ask
 * the decision point for `condo-manage` with the caller's context, throw a
 * CondoRefusedError carrying the decision on a "no" (a route hands it to
 * ApiContext.enforceDeny, as core's contact doors do), and record
 * `condo-manage` before they change anything (on-failure refuse: no record, no
 * change). Reads are checked where a person asks, the routes and the plugin.
 *
 * Every door takes the context it was given, positionally (ngdpbase security
 * guide): a person's subject, or a job's JobContext with its reason.
 */
import type { ActorContext, AddonHost, Decision } from '@jwilleke/ngdpbase-types';
import type { CondoUnit, CondoUnitProvider } from '../providers/CondoUnitProvider.js';
import type { UnitType } from './unitTypes.js';
import type { LateChargeRule } from './lateCharges.js';

/** A user on a unit: `username` is the ngdpbase account. */
export interface UnitMember { username: string; name: string; email: string | null }

/** An owner as billed: `share` is the percent of the assessment they pay. */
export interface UnitOwner extends UnitMember { share: number }

export type CondoUserType = 'owner' | 'occupant';

/** The fields condo reads from a user record (UserManager.searchUsers()). */
export interface CondoUserRecord {
  username: string;
  displayName?: string;
  email?: string;
  parcel?: unknown;
  condoUserType?: unknown;
  [key: string]: unknown;
}

export interface UnitAssessment { unitType: string; amount: number; period: UnitType['period']; datedue: UnitType['datedue'] }

/**
 * A "no" from the decision point. Carries the permission and the decision so a
 * route can hand both to ApiContext.enforceDeny, which shapes the refusal.
 */
export class CondoRefusedError extends Error {
  override readonly name = 'CondoRefusedError';
  constructor(readonly permission: string, readonly decision: Decision) {
    super(`refused: ${permission}`);
  }
}

/** What the manager hands to the audit door; index.ts wraps ngdpbase's recordAuditEvent. */
export interface CondoAuditRecord {
  eventType: ReturnType<AddonHost['addonAuditEventName']>;
  user: string;
  actor?: string;
  ipAddress: string | undefined;
  action: string;
  severity: 'low' | 'medium' | 'high';
  resource: string;
  resourceType: 'condo-unit';
  metadata: Record<string, unknown>;
}

export type Decide = (ctx: ActorContext, request: { action: string }) => Promise<Decision>;

export interface CondoUnitManagerOptions {
  provider: CondoUnitProvider;
  unitTypes: Map<string, UnitType>;
  lateCharges?: LateChargeRule[];
  /** Every user record, active or not, read as the caller (UserManager.searchUsers); absent means no users. */
  users?: (ctx: ActorContext) => Promise<CondoUserRecord[]>;
  /** ngdpbase's decision point. */
  decide: Decide;
  /** ngdpbase's recordAuditEvent for this add-on; throws when a refuse event cannot be written. */
  recordAudit: (record: CondoAuditRecord) => Promise<void>;
  /** ngdpbase's host: actorOf and the audit event names. */
  host: Pick<AddonHost, 'actorOf' | 'addonAuditEventName'>;
  /** CacheManager.bump for this manager's topic; absent in tests. */
  bump?: () => Promise<unknown>;
}

/** The providers config can name, each loaded only when chosen. */
const PROVIDERS: Record<string, (dataPath: string) => Promise<CondoUnitProvider>> = {
  json: async (dataPath) => new (await import('../providers/JsonFileCondoUnitProvider.js')).default(dataPath)
};

export async function createProvider(name: string, dataPath: string): Promise<CondoUnitProvider> {
  const make = PROVIDERS[name];
  if (!make) throw new Error(`ngdpbase.addons.condo.provider: unknown provider "${name}" (known: ${Object.keys(PROVIDERS).join(', ')})`);
  return make(dataPath);
}

/** A field that holds one string or a list of them, as a list. */
function asList(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
}

export default class CondoUnitManager {
  private units = new Map<string, CondoUnit>();
  private readonly provider: CondoUnitProvider;
  private readonly unitTypes: Map<string, UnitType>;
  private readonly lateChargeRules: LateChargeRule[];
  private readonly users: (ctx: ActorContext) => Promise<CondoUserRecord[]>;
  private readonly bump: () => Promise<unknown>;
  private readonly decide: Decide;
  private readonly recordAudit: (record: CondoAuditRecord) => Promise<void>;
  private readonly host: Pick<AddonHost, 'actorOf' | 'addonAuditEventName'>;

  constructor(options: CondoUnitManagerOptions) {
    this.provider = options.provider;
    this.unitTypes = options.unitTypes;
    this.lateChargeRules = options.lateCharges ?? [];
    this.users = options.users ?? (() => Promise.resolve([]));
    this.bump = options.bump ?? (() => Promise.resolve());
    this.decide = options.decide;
    this.recordAudit = options.recordAudit;
    this.host = options.host;
  }

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Called once during register(). ngdpbase backs up the add-on's dataPath and
   * puts a staged restore of it in place before register() runs (#1985), so
   * the units read here are already the restored ones.
   */
  async initialize(): Promise<void> {
    await this.provider.initialize();
    this.units = new Map((await this.provider.loadUnits()).map(u => [u.id, u]));
  }

  count(): number {
    return this.units.size;
  }

  /** Every unit, ordered by id. */
  list(): CondoUnit[] {
    return [...this.units.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): CondoUnit | undefined {
    return this.units.get(id);
  }

  /** Units whose fields contain the query, ignoring case. An empty query is every unit. */
  search(query: string): CondoUnit[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    return this.list().filter(u => Object.values(u)
      .filter(v => typeof v === 'string' || typeof v === 'number')
      .join(' ').toLowerCase().includes(q));
  }

  /** The users on the unit with that condo user type, ordered by username. */
  private async members(ctx: ActorContext, id: string, type: CondoUserType): Promise<UnitMember[]> {
    return (await this.users(ctx))
      .filter(u => asList(u.parcel).includes(id) && asList(u.condoUserType).includes(type))
      .sort((a, b) => a.username.localeCompare(b.username))
      .map(u => ({
        username: u.username,
        name: typeof u.displayName === 'string' && u.displayName !== '' ? u.displayName : u.username,
        email: typeof u.email === 'string' && u.email !== '' ? u.email : null
      }));
  }

  /**
   * A unit's owners, each with the share of the assessment they are billed:
   * the unit's `shares` by username, and owners without one split what is left
   * evenly. More than 100 given is refused. Every owner gets the invoice.
   * `ctx` is the caller's: the person's, or a job's with its stated reason.
   */
  async owners(ctx: ActorContext, id: string): Promise<UnitOwner[]> {
    const owners = await this.members(ctx, id, 'owner');
    const shares = (this.get(id)?.shares ?? {}) as Record<string, unknown>;
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

  /** The people living in the unit. */
  async occupants(ctx: ActorContext, id: string): Promise<UnitMember[]> {
    return this.members(ctx, id, 'occupant');
  }

  /** The unit's type, or null when it has none or its type is not configured. */
  unitType(id: string): UnitType | null {
    const type = this.get(id)?.unitType;
    return typeof type === 'string' ? this.unitTypes.get(type) ?? null : null;
  }

  /** What the unit is assessed and when it falls due, from its type; null when it has no configured type. */
  assessment(id: string): UnitAssessment | null {
    const type = this.unitType(id);
    return type ? { unitType: type.id, amount: type.assessment, period: type.period, datedue: type.datedue } : null;
  }

  /**
   * The site's late-charge rules, ordered by days late. Accounting applies them
   * to what each unit owes (https://github.com/jwilleke/ngdpbase-addons/issues/10).
   */
  lateCharges(): LateChargeRule[] {
    return this.lateChargeRules.map(r => ({ ...r }));
  }

  /** Adds the unit, or replaces the one with its id. Needs condo-manage; recorded first. */
  async upsert(ctx: ActorContext, unit: CondoUnit): Promise<void> {
    if (typeof unit.id !== 'string' || unit.id === '') throw new Error('unit.id (the parcel) is required');
    await this.authorize(ctx, 'condo-manage');
    const before = this.units.get(unit.id);
    const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(unit)])]
      .filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(unit[k]))
      .sort();
    await this.audit(ctx, before ? 'unit-update' : 'unit-create', unit.id, { fields });
    await this.write(units => units.set(unit.id, unit));
  }

  /** Removes the unit. Needs condo-manage; recorded first. */
  async delete(ctx: ActorContext, id: string): Promise<boolean> {
    await this.authorize(ctx, 'condo-manage');
    if (!this.units.has(id)) return false;
    await this.audit(ctx, 'unit-delete', id, {});
    await this.write(units => units.delete(id));
    return true;
  }

  /** Ask the decision point with the caller's context; a "no" throws CondoRefusedError. */
  private async authorize(ctx: ActorContext, action: string): Promise<void> {
    const decision = await this.decide(ctx, { action });
    if (!decision.permit) throw new CondoRefusedError(action, decision);
  }

  /**
   * Every audit record's one way out, as `condo-manage`. The "who" comes from
   * the caller's context through ngdpbase's actorOf, never copied from a name.
   */
  private async audit(ctx: ActorContext, action: string, unitId: string, metadata: Record<string, unknown>): Promise<void> {
    const { metadata: whoMetadata, ...who } = this.host.actorOf(ctx);
    await this.recordAudit({
      eventType: this.host.addonAuditEventName('condo-manage'),
      ...who,
      action, severity: 'medium', resource: unitId, resourceType: 'condo-unit',
      metadata: { ...whoMetadata, ...metadata }
    });
  }

  /** The one write path: change a copy, save it, keep it, then tell the page cache. */
  private async write(change: (units: Map<string, CondoUnit>) => unknown): Promise<void> {
    const next = new Map(this.units);
    change(next);
    await this.provider.saveUnits([...next.values()]);
    this.units = next;
    await this.bump();
  }
}
