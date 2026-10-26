/**
 * AccommodationManager — the one door to accommodations, registered on the engine as
 * 'AccommodationManager' so routes, plugins and other add-ons reach it with
 * engine.getManager('AccommodationManager').
 *
 * Accommodations are read and written through a provider chosen by config
 * (`ngdpbase.addons.accommodation.provider`, default `json`); nothing else touches the
 * store. An accommodation's `id` is its county parcel; every other field it was given is
 * kept and passed through (https://github.com/jwilleke/ngdpbase-addons/issues/4).
 * The manager names the generic ones, in schema.org terms: `accommodationCategory`,
 * `floorSize`, `address`, `containedInPlace`, plus `billing` and `notes`.
 *
 * Who owns or lives in an accommodation is ResidencyManager's (managers/ResidencyManager.ts);
 * the accommodation keeps only where its invoices go (`billing`, ngdpbase#2042).
 *
 * Every write goes through write(), which saves and then bumps the
 * 'AccommodationManager' cache topic, so pages showing accommodations re-render. Every change
 * runs, from its read to its save, inside one key of core's KeyedSerial (`host.keyedSerial()`,
 * ngdpbase 5.30.1; #39): the provider saves every accommodation in one file, so two changes, to
 * the same accommodation or to two, never overwrite each other.
 *
 * The manager is the enforcement point for changes to accommodations
 * (https://github.com/jwilleke/ngdpbase-addons/issues/5): upsert and delete ask
 * the decision point for `accommodation-manage` with the caller's context, throw an
 * AccommodationRefusedError carrying the decision on a "no" (a route hands it to
 * ApiContext.enforceDeny, as core's contact doors do), and record
 * `accommodation-manage` before they change anything (on-failure refuse: no record, no
 * change). Reads are checked where a person asks, the routes and the plugin.
 *
 * Every door takes the context it was given, positionally (ngdpbase security
 * guide): a person's subject, or a job's JobContext with its reason.
 */
import type { ActorContext, AddonHost, Decision } from '@jwilleke/ngdpbase-types';
import type { Accommodation, AccommodationProvider } from '../providers/AccommodationProvider.js';
import type { AccommodationCategory } from './categories.js';
import type { LateChargeRule } from './lateCharges.js';
import { splitIntoLines, type ChargeLine, type ChargeLineRule } from './chargeLines.js';
import { unitAddress } from './billing.js';

export interface AccommodationAssessment {
  accommodationCategory: string;
  amount: number;
  /** The amount in its charge lines, adding up to it exactly (#44). */
  lines: ChargeLine[];
  period: AccommodationCategory['period'];
  datedue: AccommodationCategory['datedue'];
}

/**
 * A "no" from the decision point. Carries the permission and the decision so a
 * route can hand both to ApiContext.enforceDeny, which shapes the refusal.
 */
export class AccommodationRefusedError extends Error {
  override readonly name = 'AccommodationRefusedError';
  constructor(readonly permission: string, readonly decision: Decision) {
    super(`refused: ${permission}`);
  }
}

/** What the manager hands to the audit door; index.ts wraps ngdpbase's recordAuditEvent. */
export interface AccommodationAuditRecord {
  eventType: ReturnType<AddonHost['addonAuditEventName']>;
  user: string;
  actor?: string;
  ipAddress: string | undefined;
  /** `failure` only for a change recorded first that then could not be written; absent is success. */
  result?: 'success' | 'failure';
  action: string;
  severity: 'low' | 'medium' | 'high';
  resource: string;
  resourceType: 'accommodation';
  metadata: Record<string, unknown>;
}

export type Decide = (ctx: ActorContext, request: { action: string }) => Promise<Decision>;

export interface AccommodationManagerOptions {
  provider: AccommodationProvider;
  categories: Map<string, AccommodationCategory>;
  lateCharges?: LateChargeRule[];
  /** The site's charge lines (#44); none means one line per assessment. */
  chargeLines?: ChargeLineRule[];
  /** ngdpbase's decision point. */
  decide: Decide;
  /** ngdpbase's recordAuditEvent for this add-on; throws when a refuse event cannot be written. */
  recordAudit: (record: AccommodationAuditRecord) => Promise<void>;
  /** ngdpbase's host: actorOf and the audit event names. */
  host: Pick<AddonHost, 'actorOf' | 'addonAuditEventName'>;
  /** CacheManager.bump for this manager's topic; absent in tests. */
  bump?: () => Promise<unknown>;
  /** core's KeyedSerial (`host.keyedSerial()`): one change at a time; absent, changes run as called (tests). */
  serial?: { run<T>(key: string, task: () => Promise<T>): Promise<T> };
}

/** The one key every change runs under: the provider keeps every accommodation in one file. */
const STORE_KEY = 'accommodations';

/** The providers config can name, each loaded only when chosen. */
const PROVIDERS: Record<string, (dataPath: string) => Promise<AccommodationProvider>> = {
  json: async (dataPath) => new (await import('../providers/JsonFileAccommodationProvider.js')).default(dataPath)
};

export async function createProvider(name: string, dataPath: string): Promise<AccommodationProvider> {
  const make = PROVIDERS[name];
  if (!make) throw new Error(`ngdpbase.addons.accommodation.provider: unknown provider "${name}" (known: ${Object.keys(PROVIDERS).join(', ')})`);
  return make(dataPath);
}

export default class AccommodationManager {
  private accommodations = new Map<string, Accommodation>();
  private readonly provider: AccommodationProvider;
  private readonly categories: Map<string, AccommodationCategory>;
  private readonly chargeLineRules: ChargeLineRule[];
  private readonly lateChargeRules: LateChargeRule[];
  private readonly bump: () => Promise<unknown>;
  private readonly decide: Decide;
  private readonly recordAudit: (record: AccommodationAuditRecord) => Promise<void>;
  private readonly host: Pick<AddonHost, 'actorOf' | 'addonAuditEventName'>;
  private readonly serial: NonNullable<AccommodationManagerOptions['serial']>;

  constructor(options: AccommodationManagerOptions) {
    this.serial = options.serial ?? { run: (_key, task) => task() };
    this.provider = options.provider;
    this.categories = options.categories;
    this.lateChargeRules = options.lateCharges ?? [];
    this.chargeLineRules = options.chargeLines ?? [];
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
   * the accommodations read here are already the restored ones.
   */
  async initialize(): Promise<void> {
    await this.provider.initialize();
    this.accommodations = new Map((await this.provider.loadAccommodations()).map(a => [a.id, a]));
  }

  count(): number {
    return this.accommodations.size;
  }

  /** Every accommodation, ordered by id. */
  list(): Accommodation[] {
    return [...this.accommodations.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): Accommodation | undefined {
    return this.accommodations.get(id);
  }

  /** Accommodations whose fields contain the query, ignoring case. An empty query is every accommodation. */
  search(query: string): Accommodation[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    return this.list().filter(a => Object.values(a)
      .filter(v => typeof v === 'string' || typeof v === 'number')
      .join(' ').toLowerCase().includes(q));
  }

  /** The accommodation's category, or null when it has none or its category is not configured. */
  category(id: string): AccommodationCategory | null {
    const category = this.get(id)?.accommodationCategory;
    return typeof category === 'string' ? this.categories.get(category) ?? null : null;
  }

  /** What the accommodation is assessed and when it falls due, from its category; null when it has no configured category. */
  assessment(id: string): AccommodationAssessment | null {
    const category = this.category(id);
    return category ? {
      accommodationCategory: category.id, amount: category.assessment, period: category.period, datedue: category.datedue,
      lines: splitIntoLines(category.assessment, this.chargeLineRules, category.name)
    } : null;
  }

  /**
   * The site's late-charge rules, ordered by days late. Accounting applies them
   * to what each accommodation owes (https://github.com/jwilleke/ngdpbase-addons/issues/10).
   */
  lateCharges(): LateChargeRule[] {
    return this.lateChargeRules.map(r => ({ ...r }));
  }

  /**
   * The accommodations as a form's choices (`optionsSource: fetch:AccommodationManager.toFormOptions()`,
   * the Occupancy information form, #32): the parcel as the value, the street address as the
   * label, never a person's name. Asked with the viewer's context for `accommodation-units-list`,
   * which accommodation's own policy grants to every visitor and every user; a "no" offers none.
   * The forms add-on asks again when the form is submitted, so a value not offered is refused.
   */
  async toFormOptions(_args: Record<string, string>, userContext: ActorContext): Promise<Array<{ value: string; label: string }>> {
    const decision = await this.decide(userContext, { action: 'accommodation-units-list' });
    if (!decision.permit) return [];
    return this.list().map(a => ({ value: a.id, label: unitAddress(a)?.streetAddress ?? a.id }));
  }

  /** Adds the accommodation, or replaces the one with its id. Needs accommodation-manage; recorded first. */
  async upsert(ctx: ActorContext, accommodation: Accommodation): Promise<void> {
    if (typeof accommodation.id !== 'string' || accommodation.id === '') throw new Error('accommodation.id (the parcel) is required');
    await this.authorize(ctx, 'accommodation-manage');
    await this.serial.run(STORE_KEY, async () => {
      const before = this.accommodations.get(accommodation.id);
      await this.audit(ctx, before ? 'accommodation-update' : 'accommodation-create', accommodation.id, { fields: changedFields(before, accommodation) });
      await this.write(all => all.set(accommodation.id, accommodation));
    });
  }

  /**
   * Changes one accommodation as it is now: `change` is handed a copy of the stored record, read
   * inside the same step as the write (#39), and returns the new one. Needs accommodation-manage;
   * recorded first. Refused when there is no such accommodation.
   */
  async update(ctx: ActorContext, id: string, change: (current: Accommodation) => Accommodation): Promise<void> {
    await this.authorize(ctx, 'accommodation-manage');
    await this.serial.run(STORE_KEY, async () => {
      const before = this.accommodations.get(id);
      if (!before) throw new Error(`no accommodation ${id}`);
      const next = { ...change(structuredClone(before)), id };
      await this.audit(ctx, 'accommodation-update', id, { fields: changedFields(before, next) });
      await this.write(all => all.set(id, next));
    });
  }

  /** Removes the accommodation. Needs accommodation-manage; recorded first. */
  async delete(ctx: ActorContext, id: string): Promise<boolean> {
    await this.authorize(ctx, 'accommodation-manage');
    return this.serial.run(STORE_KEY, async () => {
      if (!this.accommodations.has(id)) return false;
      await this.audit(ctx, 'accommodation-delete', id, {});
      await this.write(all => all.delete(id));
      return true;
    });
  }

  /** Ask the decision point with the caller's context; a "no" throws AccommodationRefusedError. */
  private async authorize(ctx: ActorContext, action: string): Promise<void> {
    const decision = await this.decide(ctx, { action });
    if (!decision.permit) throw new AccommodationRefusedError(action, decision);
  }

  /**
   * Every audit record's one way out, as `accommodation-manage`. The "who" comes from
   * the caller's context through ngdpbase's actorOf, never copied from a name.
   */
  private async audit(ctx: ActorContext, action: string, accommodationId: string, metadata: Record<string, unknown>): Promise<void> {
    const { metadata: whoMetadata, ...who } = this.host.actorOf(ctx);
    await this.recordAudit({
      eventType: this.host.addonAuditEventName('accommodation-manage'),
      ...who,
      action, severity: 'medium', resource: accommodationId, resourceType: 'accommodation',
      metadata: { ...whoMetadata, ...metadata }
    });
  }

  /** The one write path, called only inside `serial.run`: change a copy, save it, keep it, then tell the page cache. */
  private async write(change: (accommodations: Map<string, Accommodation>) => unknown): Promise<void> {
    const next = new Map(this.accommodations);
    change(next);
    await this.provider.saveAccommodations([...next.values()]);
    this.accommodations = next;
    await this.bump();
  }
}

/** The names of the fields `after` gives a different value from `before`, sorted. */
function changedFields(before: Accommodation | undefined, after: Accommodation): string[] {
  return [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])]
    .filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after[k]))
    .sort();
}
