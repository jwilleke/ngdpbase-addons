/**
 * register() against a stand-in engine and the host ngdpbase would build from
 * this add-on's own default-config.json. Data goes to a temporary folder that
 * each test removes, and nothing else.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildAddonHost, formatters } from '@jwilleke/ngdpbase-types/testing';
import AccommodationAddon from '../index.js';
import AccommodationPlugin from '../plugins/AccommodationPlugin.js';
import { SAMPLE_ACCOMMODATIONS, SAMPLE_USERS } from './fixtures.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { ngdpbase: { slug: string } };

function fakeEngine() {
  const managers = new Map<string, unknown>();
  const plugins = new Map<string, unknown>();
  const mounts: string[] = [];
  const capabilities: Record<string, boolean> = {};
  const settings: Record<string, unknown> = { views: '/core/views' };
  const cards: unknown[] = [];
  managers.set('PluginManager', { registerPlugin: async (name: string, plugin: unknown) => { plugins.set(name, plugin); } });
  managers.set('AddonsManager', { registerDashboardCard: (card: unknown) => { cards.push(card); } });
  return {
    managers, plugins, mounts, capabilities, settings, cards,
    getManager: <T>(name: string) => managers.get(name) as T | undefined,
    registerManager: (name: string, manager: unknown) => { managers.set(name, manager); },
    setCapability: (id: string, enabled: boolean) => { capabilities[id] = enabled; },
    app: {
      use: (route: string) => { mounts.push(route); },
      get: (name: string) => settings[name],
      set: (name: string, value: unknown) => { settings[name] = value; }
    },
    createRouter: () => ({ get: () => undefined, post: () => undefined }) as never
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
    expect(engine.mounts).toEqual(['/api/accommodation', '/addons/accommodation']);
    // the add-on's views join core's, which stay first
    expect(engine.settings.views).toEqual(['/core/views', path.join(path.dirname(new URL('../index.js', import.meta.url).pathname), 'views')]);
    expect(engine.cards).toEqual([{ addonName: 'accommodation', title: 'Owners and occupants', icon: 'fas fa-house-user', adminUrl: '/addons/accommodation/residents' }]);
    expect(engine.capabilities).toEqual({ accommodation: true });
    expect(await AccommodationAddon.status()).toMatchObject({ healthy: true, records: 0 });
    await AccommodationAddon.shutdown();
  });

  test('status() names the accommodations with no current owner, read as the system principal', async () => {
    const engine = fakeEngine();
    const asked: unknown[] = [];
    engine.managers.set('UserManager', { searchUsers: async (_q: string, _o: unknown, ctx: unknown) => { asked.push(ctx); return SAMPLE_USERS; } });
    writeFileSync(path.join(dataPath, 'accommodations.json'), JSON.stringify(SAMPLE_ACCOMMODATIONS));
    await AccommodationAddon.register(engine, { dataPath }, buildAddonHost('accommodation', defaults));
    asked.length = 0; // start-up reads the users once to give ownership entries their period (#43)
    const status = await AccommodationAddon.status();
    // only 66-00001.000 keeps billing entries: the other two cannot be invoiced (ngdpbase#2042)
    expect(status.message).toBe('3 accommodation(s) loaded; 1 with no current owner: 66-00003.000; 2 with no usable billing address (they cannot be invoiced)');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ reason: 'accommodation: status, accommodations with no current owner' });
    await AccommodationAddon.shutdown();
    expect(await AccommodationAddon.status()).toMatchObject({ healthy: false });
  });

  test('registers the daily roles job, which changes roles through RoleManager as the job runs', async () => {
    const engine = fakeEngine();
    const jobs: Array<{ id: string; schedule: string; run: (p: (m: string) => void, ctx: unknown) => Promise<{ success: boolean; summary?: string }> }> = [];
    const changes: unknown[][] = [];
    engine.managers.set('BackgroundJobManager', { registerJob: (def: never) => { jobs.push(def); } });
    engine.managers.set('RoleManager', {
      hasRole: async () => false,
      assignRole: async (...a: unknown[]) => { changes.push(['assign', ...a]); return true; },
      removeRole: async (...a: unknown[]) => { changes.push(['remove', ...a]); return true; }
    });
    engine.managers.set('UserManager', { searchUsers: async () => [SAMPLE_USERS[0]] });
    await AccommodationAddon.register(engine, { dataPath }, buildAddonHost('accommodation', defaults));
    expect(jobs.map(j => [j.id, j.schedule])).toEqual([['accommodation.roles', 'daily 00:05']]);
    const jobCtx = { username: 'system', origin: 'schedule', reason: 'test' };
    const result = await jobs[0].run(() => undefined, jobCtx);
    expect(result).toEqual({ success: true, summary: '1 role(s) assigned, 0 removed, 0 left alone (unreadable entries)' });
    expect(changes).toEqual([['assign', 'pat.example', 'owner', jobCtx]]);
    await AccommodationAddon.shutdown();
  });

  test('the roles job fails, naming each refused change, when RoleManager throws', async () => {
    const engine = fakeEngine();
    const jobs: Array<{ run: (p: (m: string) => void, ctx: unknown) => Promise<{ success: boolean; error?: string }> }> = [];
    engine.managers.set('BackgroundJobManager', { registerJob: (def: never) => { jobs.push(def); } });
    engine.managers.set('RoleManager', {
      hasRole: async () => false,
      assignRole: async () => { throw new Error('role save failed'); },
      removeRole: async () => true
    });
    engine.managers.set('UserManager', { searchUsers: async () => [SAMPLE_USERS[0]] });
    await AccommodationAddon.register(engine, { dataPath }, buildAddonHost('accommodation', defaults));
    const result = await jobs[0].run(() => undefined, { username: 'system', origin: 'schedule', reason: 'test' });
    expect(result).toMatchObject({ success: false, error: '1 role change(s) refused: assign owner for pat.example: role save failed' });
    await AccommodationAddon.shutdown();
  });

  test('declares the owner and occupant roles it assigns', () => {
    const roles = defaults['ngdpbase.roles.definitions'] as Record<string, { name: string }>;
    expect(Object.keys(roles)).toEqual(['owner', 'occupant']);
    expect(roles.owner.name).toBe('owner');
  });

  test('the plugin escapes what it is given', () => {
    expect(AccommodationPlugin.execute({ formatters }, { id: '<b>07</b>' })).toBe('<span class="accommodation">Accommodation &lt;b&gt;07&lt;/b&gt;</span>');
  });
});
