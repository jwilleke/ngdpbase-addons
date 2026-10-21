/**
 * register() against a stand-in engine and the host ngdpbase would build from
 * this add-on's own default-config.json. Nothing is written to disk.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildAddonHost, formatters } from '@jwilleke/ngdpbase-types/testing';
import CondoAddon from '../index.js';
import CondoUnitPlugin from '../plugins/CondoUnitPlugin.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { ngdpbase: { slug: string } };

function fakeEngine() {
  const managers = new Map<string, unknown>();
  const plugins = new Map<string, unknown>();
  const mounts: string[] = [];
  const capabilities: Record<string, boolean> = {};
  managers.set('PluginManager', { registerPlugin: async (name: string, plugin: unknown) => { plugins.set(name, plugin); } });
  return {
    managers, plugins, mounts, capabilities,
    getManager: <T>(name: string) => managers.get(name) as T | undefined,
    registerManager: (name: string, manager: unknown) => { managers.set(name, manager); },
    setCapability: (id: string, enabled: boolean) => { capabilities[id] = enabled; },
    app: { use: (route: string) => { mounts.push(route); } },
    createRouter: () => ({ get: () => undefined }) as never
  };
}

describe('condo register()', () => {
  test('name is the manifest slug', () => {
    expect(CondoAddon.name).toBe(pkg.ngdpbase.slug);
  });

  test('registers the manager, the plugin, the API and the capability', async () => {
    const engine = fakeEngine();
    await CondoAddon.register(engine, {}, buildAddonHost('condo', defaults));
    expect(engine.managers.get('CondoUnitManager')).toBeDefined();
    expect(engine.plugins.get('CondoUnit')).toBe(CondoUnitPlugin);
    expect(engine.mounts).toEqual(['/api/condo']);
    expect(engine.capabilities).toEqual({ condo: true });
    expect(CondoAddon.status()).toMatchObject({ healthy: true, records: 0 });
    await CondoAddon.shutdown();
  });

  test('the plugin escapes what it is given', () => {
    expect(CondoUnitPlugin.execute({ formatters }, { unit: '<b>07</b>' })).toBe('<span class="condo-unit">Unit &lt;b&gt;07&lt;/b&gt;</span>');
  });
});
