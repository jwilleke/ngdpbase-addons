/**
 * Condo add-on for ngdpbase: a condominium's units, keyed by the county parcel,
 * and their owners (epic https://github.com/jwilleke/ngdpbase-addons/issues/9).
 * The Fairways Condominiums is the reference site.
 *
 * register() registers CondoUnitManager and the [{CondoUnit}] plugin, mounts
 * the API at /api/condo, and sets the `condo` capability.
 *
 * Configuration keys:
 *   ngdpbase.addons.condo.enabled  — true/false (defaults to false)
 *   ngdpbase.addons.condo.dataPath — the data folder; defaults to ./data/condo
 *                                    under the instance data folder
 *   ngdpbase.addons.condo.provider — where units are stored; `json` (units.json in dataPath)
 *   ngdpbase.addons.condo.unit-types — { "<type>": { name, assessment, period, datedue } }
 *   ngdpbase.addons.condo.late-charges — { "<rule>": { days-late, amount, annual-percent, repeat } }
 *
 * The exported `name` MUST equal `ngdpbase.slug` in package.json (#927).
 */
import type { ActorContext, AddonHost, Decision } from '@jwilleke/ngdpbase-types';
import apiRoutes from './routes/api.js';
import CondoUnitManager, { createProvider, type CondoUserRecord, type DirectoryBackupParts } from './managers/CondoUnitManager.js';
import { unitTypesFrom } from './managers/unitTypes.js';
import { lateChargesFrom } from './managers/lateCharges.js';
import CondoUnitPlugin from './plugins/CondoUnitPlugin.js';

interface PluginManagerLike { registerPlugin(name: string, plugin: unknown): Promise<void> }
interface ConfigurationManagerLike { resolveDataPath(p: string): string }
interface CacheManagerLike { bump(topic: string): Promise<unknown> }
interface PolicyDecisionPointLike { decide(subject: unknown, request: { action: string }): Promise<Decision> }
interface UserManagerLike {
  searchUsers(query: string, options: { limit?: number; activeOnly?: boolean }, ctx: ActorContext): Promise<CondoUserRecord[]>;
}

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  registerManager(name: string, manager: unknown): void;
  setCapability(id: string, enabled: boolean): void;
  app?: { use(route: string, handler: unknown): void };
  createRouter(): import('express').Router;
}

let units: CondoUnitManager | null = null;

/** The three directory-backup helpers from host, or null on a core that does not offer them (interim, ngdpbase-addons#13). */
function backupPartsFrom(host: AddonHost): DirectoryBackupParts | null {
  const h = host as unknown as Partial<DirectoryBackupParts>;
  return typeof h.backupDirectoryPart === 'function' && typeof h.stageDirectoryPart === 'function' && typeof h.applyDirectoryPartAtStart === 'function'
    ? { backupDirectoryPart: h.backupDirectoryPart, stageDirectoryPart: h.stageDirectoryPart, applyDirectoryPartAtStart: h.applyDirectoryPartAtStart }
    : null;
}

const CondoAddon = {
  name: 'condo',
  version: '0.1.0',
  description: 'Condominium unit registry: units by parcel and their owners',
  author: 'jwilleke',
  dependencies: [] as string[],

  async register(engine: Engine, config: Record<string, unknown>, host: AddonHost): Promise<void> {
    const configured = typeof config['dataPath'] === 'string' && config['dataPath'] !== '' ? config['dataPath'] : './data/condo';
    const dataPath = engine.getManager<ConfigurationManagerLike>('ConfigurationManager')?.resolveDataPath(configured) ?? configured;

    const providerName = typeof config['provider'] === 'string' && config['provider'] !== '' ? config['provider'] : 'json';
    const pdp = engine.getManager<PolicyDecisionPointLike>('PolicyDecisionPoint');
    const auditSink = engine.getManager<Parameters<typeof host.recordAuditEvent>[0]>('AuditManager');
    units = new CondoUnitManager({
      host,
      // No decision point is a "no" (fail closed).
      decide: async (subject, request) => pdp ? pdp.decide(subject, request) : { permit: false, applicable: false, reason: 'no_decision_point' } as Decision,
      // condo-manage is a refuse event: a record that cannot be written throws here, and the change stops.
      recordAudit: async (record) => { await host.recordAuditEvent(auditSink, { ...record, result: 'success' } as never); },
      provider: await createProvider(providerName, dataPath),
      dataPath,
      // Core's directory-backup helpers, interim until ngdpbase#1985 (ngdpbase-addons#13).
      backupParts: backupPartsFrom(host),
      configManager: engine.getManager('ConfigurationManager'),
      unitTypes: unitTypesFrom(config['unit-types']),
      lateCharges: lateChargesFrom(config['late-charges']),
      // Every user, inactive ones too: an owner whose account is off still owes.
      users: async (ctx) => (await engine.getManager<UserManagerLike>('UserManager')?.searchUsers('', { limit: 0, activeOnly: false }, ctx)) ?? [],
      bump: () => engine.getManager<CacheManagerLike>('CacheManager')?.bump('CondoUnitManager') ?? Promise.resolve()
    });
    await units.initialize();
    engine.registerManager('CondoUnitManager', units);
    host.logger.info(`[condo] Units from provider '${units.providerName}': ${units.count()}`);

    await engine.getManager<PluginManagerLike>('PluginManager')?.registerPlugin('CondoUnit', CondoUnitPlugin);

    engine.app?.use('/api/condo', apiRoutes(engine, host));
    engine.setCapability('condo', true);
  },

  status(): { healthy: boolean; records: number; message: string } {
    const count = units?.count() ?? 0;
    return { healthy: units !== null, records: count, message: `${count} unit(s) loaded` };
  },

  async shutdown(): Promise<void> {
    units = null;
  }
};

export default CondoAddon;
