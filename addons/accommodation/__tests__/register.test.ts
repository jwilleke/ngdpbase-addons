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
import AccommodationAddon from '../index.js';
import AccommodationPlugin from '../plugins/AccommodationPlugin.js';

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

describe('accommodation register()', () => {
  let dataPath: string;
  beforeEach(() => { dataPath = mkdtempSync(path.join(tmpdir(), 'accommodation-register-')); });
  afterEach(() => { rmSync(dataPath, { recursive: true, force: true }); });

  test('name is the manifest slug', () => {
    expect(AccommodationAddon.name).toBe(pkg.ngdpbase.slug);
  });

  test('registers the managers, the plugin, the API and the capability', async () => {
    const engine = fakeEngine();
    await AccommodationAddon.register(engine, { dataPath }, buildAddonHost('accommodation', defaults));
    expect(engine.managers.get('AccommodationManager')).toBeDefined();
    expect(engine.managers.get('ResidencyManager')).toBeDefined();
    expect(engine.plugins.get('Accommodation')).toBe(AccommodationPlugin);
    expect(engine.mounts).toEqual(['/api/accommodation']);
    expect(engine.capabilities).toEqual({ accommodation: true });
    expect(AccommodationAddon.status()).toMatchObject({ healthy: true, records: 0 });
    await AccommodationAddon.shutdown();
  });

  test('the plugin escapes what it is given', () => {
    expect(AccommodationPlugin.execute({ formatters }, { id: '<b>07</b>' })).toBe('<span class="accommodation">Accommodation &lt;b&gt;07&lt;/b&gt;</span>');
  });
});
