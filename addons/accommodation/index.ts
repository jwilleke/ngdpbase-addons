/**
 * Accommodation add-on for ngdpbase: accommodations (schema.org `Accommodation`), keyed by
 * the county parcel, and their owners and occupants (epic
 * https://github.com/jwilleke/ngdpbase-addons/issues/19). The Fairways Condominiums is the
 * reference site; nothing here is condo-only, so a landlord can use it too.
 *
 * register() registers AccommodationManager, ResidencyManager and the [{Accommodation}]
 * plugin, mounts the API at /api/accommodation, and sets the `accommodation` capability.
 *
 * Configuration keys:
 *   ngdpbase.addons.accommodation.enabled  — true/false (defaults to false)
 *   ngdpbase.addons.accommodation.dataPath — the data folder; defaults to <instance data folder>/accommodation.
 *                                            ngdpbase backs it up and restores it; the add-on writes no
 *                                            backup code (ngdpbase#1985)
 *   ngdpbase.addons.accommodation.provider — where accommodations are stored; `json`
 *                                            (accommodations.json in dataPath)
 *   ngdpbase.addons.accommodation.categories   — { "<category>": { name, assessment, period, datedue } }
 *   ngdpbase.addons.accommodation.late-charges — { "<rule>": { days-late, amount, annual-percent, repeat } }
 *
 * The exported `name` MUST equal `ngdpbase.slug` in package.json (#927).
 */
import type { ActorContext, AddonHost, Decision } from '@jwilleke/ngdpbase-types';
import apiRoutes from './routes/api.js';
import path from 'node:path';
import AccommodationManager, { createProvider } from './managers/AccommodationManager.js';
import ResidencyManager, { type UserRecord } from './managers/ResidencyManager.js';
import { categoriesFrom } from './managers/categories.js';
import { lateChargesFrom } from './managers/lateCharges.js';
import AccommodationPlugin from './plugins/AccommodationPlugin.js';

interface PluginManagerLike { registerPlugin(name: string, plugin: unknown): Promise<void> }
interface ConfigurationManagerLike { resolveDataPath(p: string): string }
interface CacheManagerLike { bump(topic: string): Promise<unknown> }
interface PolicyDecisionPointLike { decide(subject: unknown, request: { action: string }): Promise<Decision> }
interface UserManagerLike {
  searchUsers(query: string, options: { limit?: number; activeOnly?: boolean }, ctx: ActorContext): Promise<UserRecord[]>;
}

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  registerManager(name: string, manager: unknown): void;
  setCapability(id: string, enabled: boolean): void;
  app?: { use(route: string, handler: unknown): void };
  createRouter(): import('express').Router;
}

let accommodations: AccommodationManager | null = null;

const AccommodationAddon = {
  name: 'accommodation',
  version: '0.1.0',
  description: 'Accommodations by parcel, their categories, and their owners and occupants',
  author: 'jwilleke',
  dependencies: [] as string[],

  async register(engine: Engine, config: Record<string, unknown>, host: AddonHost): Promise<void> {
    // The same folder ngdpbase backs up and restores for this add-on (#1985): the configured
    // dataPath as given, else <instance data folder>/accommodation.
    const configured = typeof config['dataPath'] === 'string' && config['dataPath'] !== '' ? config['dataPath'] : null;
    const dataPath = path.resolve(configured ?? engine.getManager<ConfigurationManagerLike>('ConfigurationManager')?.resolveDataPath('accommodation') ?? './data/accommodation');

    const providerName = typeof config['provider'] === 'string' && config['provider'] !== '' ? config['provider'] : 'json';
    const pdp = engine.getManager<PolicyDecisionPointLike>('PolicyDecisionPoint');
    const auditSink = engine.getManager<Parameters<typeof host.recordAuditEvent>[0]>('AuditManager');
    accommodations = new AccommodationManager({
      host,
      // No decision point is a "no" (fail closed).
      decide: async (subject, request) => pdp ? pdp.decide(subject, request) : { permit: false, applicable: false, reason: 'no_decision_point' } as Decision,
      // accommodation-manage is a refuse event: a record that cannot be written throws here, and the change stops.
      recordAudit: async (record) => { await host.recordAuditEvent(auditSink, { ...record, result: 'success' } as never); },
      provider: await createProvider(providerName, dataPath),
      categories: categoriesFrom(config['categories']),
      lateCharges: lateChargesFrom(config['late-charges']),
      bump: () => engine.getManager<CacheManagerLike>('CacheManager')?.bump('AccommodationManager') ?? Promise.resolve()
    });
    await accommodations.initialize();
    engine.registerManager('AccommodationManager', accommodations);

    const accommodationManager = accommodations;
    engine.registerManager('ResidencyManager', new ResidencyManager({
      // Every user, inactive ones too: an owner whose account is off still owes.
      users: async (ctx) => (await engine.getManager<UserManagerLike>('UserManager')?.searchUsers('', { limit: 0, activeOnly: false }, ctx)) ?? [],
      accommodation: (id) => accommodationManager.get(id)
    }));
    host.logger.info(`[accommodation] Accommodations from provider '${accommodations.providerName}': ${accommodations.count()}`);

    await engine.getManager<PluginManagerLike>('PluginManager')?.registerPlugin('Accommodation', AccommodationPlugin);

    engine.app?.use('/api/accommodation', apiRoutes(engine, host));
    engine.setCapability('accommodation', true);
  },

  status(): { healthy: boolean; records: number; message: string } {
    const count = accommodations?.count() ?? 0;
    return { healthy: accommodations !== null, records: count, message: `${count} accommodation(s) loaded` };
  },

  async shutdown(): Promise<void> {
    accommodations = null;
  }
};

export default AccommodationAddon;
