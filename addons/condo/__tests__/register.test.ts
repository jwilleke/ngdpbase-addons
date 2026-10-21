/**
 * register() against a stand-in engine and the host ngdpbase would build from
 * this add-on's own default-config.json. Data goes to a temporary folder that
 * each test removes, and nothing else.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
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
  let dataPath: string;
  beforeEach(() => { dataPath = mkdtempSync(path.join(tmpdir(), 'condo-register-')); });
  afterEach(() => { rmSync(dataPath, { recursive: true, force: true }); });

  test('name is the manifest slug', () => {
    expect(CondoAddon.name).toBe(pkg.ngdpbase.slug);
  });

  test('registers the manager, the plugin, the API and the capability', async () => {
    const engine = fakeEngine();
    await CondoAddon.register(engine, { dataPath }, buildAddonHost('condo', defaults));
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
