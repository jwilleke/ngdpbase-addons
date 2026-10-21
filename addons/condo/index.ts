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
 *
 * The exported `name` MUST equal `ngdpbase.slug` in package.json (#927).
 */
import type { AddonHost } from '@jwilleke/ngdpbase-types';
import apiRoutes from './routes/api.js';
import CondoUnitManager from './managers/CondoUnitManager.js';
import CondoUnitPlugin from './plugins/CondoUnitPlugin.js';

interface PluginManagerLike { registerPlugin(name: string, plugin: unknown): Promise<void> }
interface ConfigurationManagerLike { resolveDataPath(p: string): string }

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  registerManager(name: string, manager: unknown): void;
  setCapability(id: string, enabled: boolean): void;
  app?: { use(route: string, handler: unknown): void };
  createRouter(): import('express').Router;
}

let units: CondoUnitManager | null = null;

const CondoAddon = {
  name: 'condo',
  version: '0.1.0',
  description: 'Condominium unit registry: units by parcel and their owners',
  author: 'jwilleke',
  dependencies: [] as string[],

  async register(engine: Engine, config: Record<string, unknown>, host: AddonHost): Promise<void> {
    const configured = typeof config['dataPath'] === 'string' && config['dataPath'] !== '' ? config['dataPath'] : './data/condo';
    const dataPath = engine.getManager<ConfigurationManagerLike>('ConfigurationManager')?.resolveDataPath(configured) ?? configured;

    units = new CondoUnitManager(dataPath);
    await units.load();
    engine.registerManager('CondoUnitManager', units);

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
