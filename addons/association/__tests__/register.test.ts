/**
 * register() against a stand-in engine and the host ngdpbase would build from this add-on's
 * own default-config.json. The database is core's in-memory one; nothing is written to disk.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import AssociationAddon from '../index.js';
import { OCCUPANCY_FORM_ID } from '../forms/occupancyForm.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { ngdpbase: { slug: string; aboutPage: string } };

/** Accommodation's managers, a database and, unless `forms` is false, the forms add-on. */
function fakeEngine(options: { database?: boolean; forms?: boolean } = {}) {
  const managers = new Map<string, unknown>();
  const shipped: unknown[][] = [];
  const handlers = new Map<string, (submission: unknown, context: { engine: unknown; req: unknown }) => Promise<unknown>>();
  const opened: unknown[] = [];
  const mounts: string[] = [];
  const cards: unknown[] = [];
  const settings: Record<string, unknown> = { views: '/core/views' };
  managers.set('AccommodationManager', { count: () => 3 });
  managers.set('ResidencyManager', { checkEntry: () => null });
  managers.set('DatabaseManager', {
    isEnabled: () => options.database !== false,
    openAddonDatabase: (owner: string, o: { migrations: never; ledgerTable: string }) => {
      const db = openAddonTestDatabase(owner, o, { slug: 'association', defaults });
      opened.push(db);
      return db;
    }
  });
  managers.set('PolicyDecisionPoint', { usersHolding: async () => [], decide: async () => ({ permit: true }) });
  managers.set('AddonsManager', { registerDashboardCard: (card: unknown) => { cards.push(card); } });
  if (options.forms !== false) {
    managers.set('FormsDataManager', { registerShippedForm: async (...a: unknown[]) => { shipped.push(a); return 'saved'; } });
    managers.set('FormsAddon', { registerHandler: (id: string, h: never) => { handlers.set(id, h); } });
  }
  return {
    managers, shipped, handlers, opened, mounts, cards, settings,
    getManager: <T>(name: string) => managers.get(name) as T | undefined,
    registerManager: (name: string, manager: unknown) => { managers.set(name, manager); },
    app: { use: (route: string) => { mounts.push(route); }, get: (k: string) => settings[k], set: (k: string, v: unknown) => { settings[k] = v; } },
    createRouter: () => ({ get: () => undefined, post: () => undefined }) as never
  };
}

describe('association register()', () => {
  test('name is the manifest slug; accommodation is required, forms optional', () => {
    expect(AssociationAddon.name).toBe(pkg.ngdpbase.slug);
    expect(AssociationAddon.dependencies).toEqual(['accommodation']);
    expect(AssociationAddon.optionalDependencies).toEqual(['forms']);
  });

  test('declares an encrypted database: submissions hold personal data', () => {
    expect(defaults['ngdpbase.addons.association.database']).toEqual({ owner: 'association', ledgerTable: 'association_schema_migrations', encrypt: 'required' });
  });

  test('opens its database, ships the form as the system principal, and its handler keeps a submission as the sender', async () => {
    const engine = fakeEngine();
    await AssociationAddon.register(engine, {}, buildAddonHost('association', defaults));
    expect(engine.managers.get('OccupancyManager')).toBeDefined();
    expect(engine.mounts).toEqual(['/addons/association']);
    expect((engine.settings.views as string[])[0]).toBe('/core/views');
    expect(engine.cards).toEqual([{ addonName: 'association', title: 'Occupancy review', icon: 'fas fa-clipboard-check', adminUrl: '/addons/association/review' }]);
    expect(engine.shipped).toHaveLength(1);
    const [addon, definition, ctx] = engine.shipped[0] as [string, { id: string; store: boolean; notify: boolean }, { reason: string }];
    expect([addon, definition.id, definition.store, definition.notify]).toEqual(['association', OCCUPANCY_FORM_ID, false, false]);
    expect(ctx.reason).toBe('association: register the Occupancy information form');

    const handler = engine.handlers.get(OCCUPANCY_FORM_ID)!;
    const req = { userContext: { username: 'anonymous', roles: ['anonymous'], isAuthenticated: false } };
    const result = await handler({ id: 's-1', submittedBy: 'anonymous', data: { email: 'a@example.org', existingOwner: 'No', unit: '66-00001.000', from: '2026-10-01' } }, { engine, req });
    expect(result).toEqual({ ok: true });
    expect(await AssociationAddon.status()).toEqual({ healthy: true, message: 'On 3 accommodation(s); 1 occupancy submission(s) waiting for review' });
    await AssociationAddon.shutdown();
    (engine.opened[0] as { close(): void }).close();
  });

  test('without the site database it does not start, and says how to fix it', async () => {
    const engine = fakeEngine({ database: false });
    await AssociationAddon.register(engine, {}, buildAddonHost('association', defaults));
    expect(engine.shipped).toEqual([]);
    expect(await AssociationAddon.status()).toMatchObject({ healthy: false, message: expect.stringContaining("ngdpbase.database.provider to 'sqlite'") });
    await AssociationAddon.shutdown();
  });

  test('without the forms add-on it still loads, and offers no form', async () => {
    const engine = fakeEngine({ forms: false });
    await AssociationAddon.register(engine, {}, buildAddonHost('association', defaults));
    expect(await AssociationAddon.status()).toMatchObject({ healthy: true });
    await AssociationAddon.shutdown();
    (engine.opened[0] as { close(): void }).close();
  });

  test('does not load without accommodation', async () => {
    const engine = fakeEngine();
    engine.managers.delete('AccommodationManager');
    await expect(AssociationAddon.register(engine, {}, buildAddonHost('association', defaults))).rejects.toThrow('enable the accommodation add-on');
  });

  test('the about page it names is the page it ships', () => {
    const page = readFileSync(new URL('../pages/31a3859f-33d3-4639-aeed-9210a87d0e09.md', import.meta.url), 'utf8');
    expect(page).toContain(`slug: ${pkg.ngdpbase.aboutPage}`);
  });
});
