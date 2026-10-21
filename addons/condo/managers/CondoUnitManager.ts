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
 */
import type { ActorContext } from '@jwilleke/ngdpbase-types';
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

/** Core's BackupData (src/managers/BaseManager.ts), as this manager fills it. */
export interface CondoBackupData {
  managerName: string;
  timestamp: string;
  providerClass?: string | null;
  data?: unknown;
  [key: string]: unknown;
}

export interface CondoUnitManagerOptions {
  provider: CondoUnitProvider;
  unitTypes: Map<string, UnitType>;
  lateCharges?: LateChargeRule[];
  /** Every user record, active or not, read as the caller (UserManager.searchUsers); absent means no users. */
  users?: (ctx: ActorContext) => Promise<CondoUserRecord[]>;
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

  constructor(options: CondoUnitManagerOptions) {
    this.provider = options.provider;
    this.unitTypes = options.unitTypes;
    this.lateChargeRules = options.lateCharges ?? [];
    this.users = options.users ?? (() => Promise.resolve([]));
    this.bump = options.bump ?? (() => Promise.resolve());
  }

  get providerName(): string {
    return this.provider.name;
  }

  /** Called once during register(). */
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

  /**
   * This manager's part of a site backup: every unit, in the backup document.
   * Same shape as core's BaseManager.backup() (add-ons cannot import BaseManager).
   */
  async backup(): Promise<CondoBackupData> {
    return {
      managerName: 'CondoUnitManager',
      timestamp: new Date().toISOString(),
      providerClass: this.provider.name,
      data: { units: this.list() }
    };
  }

  /**
   * Puts the units from a backup back, replacing every unit, through the one
   * write path. A backup that is not this manager's, or holds no unit list, is
   * refused and nothing changes.
   */
  async restore(backup: CondoBackupData): Promise<void> {
    const units = (backup?.data as { units?: unknown } | null | undefined)?.units;
    if (backup?.managerName !== 'CondoUnitManager' || !Array.isArray(units)) {
      throw new Error('CondoUnitManager: not a condo units backup');
    }
    const bad = units.findIndex(u => !u || typeof u !== 'object' || typeof (u as { id?: unknown }).id !== 'string' || (u as { id: string }).id === '');
    if (bad !== -1) throw new Error(`CondoUnitManager: backup unit ${bad} has no parcel id`);
    await this.write(current => {
      current.clear();
      for (const u of units as CondoUnit[]) current.set(u.id, u);
    });
  }

  /** Adds the unit, or replaces the one with its id. */
  async upsert(unit: CondoUnit): Promise<void> {
    if (typeof unit.id !== 'string' || unit.id === '') throw new Error('unit.id (the parcel) is required');
    await this.write(units => units.set(unit.id, unit));
  }

  async delete(id: string): Promise<boolean> {
    if (!this.units.has(id)) return false;
    await this.write(units => units.delete(id));
    return true;
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
