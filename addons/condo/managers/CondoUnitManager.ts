/**
 * CondoUnitManager — the one door to condo units, registered on the engine as
 * 'CondoUnitManager' so routes, plugins and other add-ons reach it with
 * engine.getManager('CondoUnitManager').
 *
 * Units are read and written through a provider chosen by config
 * (`ngdpbase.addons.condo.provider`, default `json`); nothing else touches the
 * store. A unit's `id` is its county parcel; every other field it was given is
 * kept and passed through (https://github.com/jwilleke/ngdpbase-addons/issues/4).
 * The manager names the generic ones: `unitType`, `owners`, `notes`.
 *
 * Every write goes through write(), which saves and then bumps the
 * 'CondoUnitManager' cache topic, so pages showing units re-render.
 */
import type { CondoUnit, CondoUnitProvider } from '../providers/CondoUnitProvider.js';
import type { UnitType } from './unitTypes.js';
import type { LateChargeRule } from './lateCharges.js';

/** An owner as billed: `person` is the ngdpbase contact `@id`, `share` the percent of the assessment. */
export interface UnitOwner { name: string; person: string | null; share: number }

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

/**
 * An owner entry as stored, read the same way whatever its age: a plain name
 * (how owners were first kept), or `{ name, person?, share? }`.
 */
function readOwner(o: unknown): { name: string; person: string | null; share: number | null } | null {
  if (typeof o === 'string') return o.trim() ? { name: o.trim(), person: null, share: null } : null;
  if (!o || typeof o !== 'object') return null;
  const rec = o as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name.trim() : '';
  if (!name) return null;
  const person = typeof rec.person === 'string' && rec.person.trim() ? rec.person.trim() : null;
  const share = typeof rec.share === 'number' && Number.isFinite(rec.share) ? rec.share : null;
  return { name, person, share };
}

export default class CondoUnitManager {
  private units = new Map<string, CondoUnit>();
  private readonly provider: CondoUnitProvider;
  private readonly unitTypes: Map<string, UnitType>;
  private readonly lateChargeRules: LateChargeRule[];
  private readonly bump: () => Promise<unknown>;

  constructor(options: CondoUnitManagerOptions) {
    this.provider = options.provider;
    this.unitTypes = options.unitTypes;
    this.lateChargeRules = options.lateCharges ?? [];
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

  /** Units whose fields or owners' names contain the query, ignoring case. An empty query is every unit. */
  search(query: string): CondoUnit[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    return this.list().filter(u => {
      const values = Object.entries(u)
        .filter(([k, v]) => k !== 'owners' && (typeof v === 'string' || typeof v === 'number'))
        .map(([, v]) => String(v));
      const owners = (Array.isArray(u.owners) ? u.owners : []).map(readOwner).filter(o => o !== null).map(o => o.name);
      return [...values, ...owners].join(' ').toLowerCase().includes(q);
    });
  }

  /**
   * A unit's owners, each with the share of the assessment they are billed:
   * as given, and owners without one split what is left evenly. More than 100
   * given is refused.
   */
  owners(id: string): UnitOwner[] {
    const unit = this.get(id);
    const list = (Array.isArray(unit?.owners) ? unit.owners : []).map(readOwner).filter(o => o !== null);
    const given = list.reduce((t, o) => t + (o.share ?? 0), 0);
    if (given > 100) throw new Error(`unit ${id}: owners' shares add up to ${given}%, more than 100%`);
    const unshared = list.filter(o => o.share === null).length;
    const each = unshared ? (100 - given) / unshared : 0;
    return list.map(o => ({ name: o.name, person: o.person, share: o.share ?? each }));
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
