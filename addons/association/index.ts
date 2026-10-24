/**
 * Association add-on for ngdpbase: a unit owners association's own rules, on top of the
 * `accommodation` add-on, which keeps the units and who owns and lives in them (epic
 * https://github.com/jwilleke/ngdpbase-addons/issues/19). The Fairways Condominiums is the
 * reference site.
 *
 * Thin to start (operator, 2026-10-24, https://github.com/jwilleke/ngdpbase-addons/issues/25):
 * The Fairways' rules become settings here, each citing where it comes from (ORC 5311, the
 * Declaration, the Bylaws, a board rule), as each feature needs one. No statute profiles yet.
 *
 * The Occupancy information form (ORC 5311.09; #17, #32): register() ships it to the forms
 * add-on and registers its handler, which keeps every submission for review in the add-on's
 * encrypted database (OccupancyManager) and tells the holders of `association-review`.
 *
 * Configuration keys:
 *   ngdpbase.addons.association.enabled  — true/false (defaults to false); needs
 *                                           ngdpbase.addons.accommodation.enabled too
 *   ngdpbase.addons.association.database — declared, not set: encrypted, so the site needs
 *                                           ngdpbase.database.provider sqlite and NGDPBASE_DATABASE_KEY
 *
 * The exported `name` MUST equal `ngdpbase.slug` in package.json (#927).
 */
import type { ActorContext, AddonHost, Decision } from '@jwilleke/ngdpbase-types';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import reviewRoutes from './routes/review.js';
import OccupancyManager, { type ApprovalDoors, type EntryRef, type OccupancyAuditRecord, type OccupancyDb, type OccupancyManagerOptions, type OccupancySubmission } from './managers/OccupancyManager.js';
import { ASSOCIATION_LEDGER_TABLE, ASSOCIATION_MIGRATIONS } from './managers/migrations.js';
import { OCCUPANCY_FORM_ID, occupancyForm } from './forms/occupancyForm.js';

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  registerManager(name: string, manager: unknown): void;
  app?: { use(route: string, handler: unknown): void; get?(setting: string): unknown; set?(setting: string, value: unknown): void };
  createRouter(): import('express').Router;
  templateData?: (req: import('express').Request) => Promise<Record<string, unknown>>;
}

interface AccommodationManagerLike { count(): number }
interface ResidencyManagerLike {
  checkEntry: OccupancyManagerOptions['checkEntry'];
  changeLink(ctx: ActorContext, username: string, change: unknown): Promise<{ changed: boolean; at?: EntryRef }>;
}
interface UserManagerLike {
  searchUsers(query: string, options: { limit?: number; activeOnly?: boolean }, ctx: ActorContext): Promise<Array<{ username: string; email?: string }>>;
}
interface PersonManagerLike {
  search(ctx: ActorContext, query: string, options?: { limit?: number }): Promise<Array<{ '@id': string; identifier: string; contactPoint?: unknown[] }>>;
  update(ctx: ActorContext, id: string, patch: Record<string, unknown>): Promise<unknown>;
}
interface DatabaseManagerLike {
  isEnabled(): boolean;
  openAddonDatabase<Handle>(owner: string, options: { migrations: unknown[]; ledgerTable: string }): Handle;
}
interface PolicyDecisionPointLike {
  decide(ctx: ActorContext, request: { action: string }): Promise<Decision>;
  usersHolding(action: string): Promise<string[] | null>;
}
interface AddonsManagerLike {
  registerDashboardCard(card: { addonName: string; title: string; icon: string; adminUrl: string }): void;
}
interface NotificationManagerLike {
  addNotification(n: { type: 'system'; level: 'info'; title: string; message: string; targetUsers: string[] }): Promise<string>;
}
interface FormsDataManagerLike { registerShippedForm(addon: string, definition: unknown, ctx: ActorContext): Promise<string> }
interface FormsAddonLike {
  registerHandler(formId: string, handler: (submission: OccupancySubmission, context: { engine: unknown; req: unknown }) => Promise<unknown>): void;
}

let accommodations: AccommodationManagerLike | null = null;
let occupancy: OccupancyManager | null = null;
let unavailable: string | null = 'not registered yet';

const AssociationAddon = {
  name: 'association',
  version: '0.1.0',
  description: "A unit owners association's rules, on top of accommodation",
  author: 'jwilleke',
  // accommodation loads first; without it this add-on does not load.
  dependencies: ['accommodation'],
  // forms carries the Occupancy information form: loaded first when the site has it.
  optionalDependencies: ['forms'],

  async register(engine: Engine, _config: Record<string, unknown>, host: AddonHost): Promise<void> {
    const { logger } = host;
    accommodations = engine.getManager<AccommodationManagerLike>('AccommodationManager') ?? null;
    const residency = engine.getManager<ResidencyManagerLike>('ResidencyManager');
    if (!accommodations || !residency) throw new Error('[association] AccommodationManager is not loaded; enable the accommodation add-on');

    const databases = engine.getManager<DatabaseManagerLike>('DatabaseManager');
    if (!databases?.isEnabled()) {
      unavailable = "the site's database is off: set ngdpbase.database.provider to 'sqlite', set NGDPBASE_DATABASE_KEY, and restart";
      logger.warn(`[association] Not started: ${unavailable}`);
      return;
    }
    // A failed open or migration leaves register(), so the add-on is reported as not loaded.
    const db = databases.openAddonDatabase<OccupancyDb>('association', { migrations: ASSOCIATION_MIGRATIONS, ledgerTable: ASSOCIATION_LEDGER_TABLE });

    const auditSink = engine.getManager<Parameters<typeof host.recordAuditEvent>[0]>('AuditManager');
    const recordAudit = async (record: OccupancyAuditRecord): Promise<void> => {
      // occupancy-submit is a refuse event: a record that cannot be written throws here, and nothing is kept.
      await host.recordAuditEvent(auditSink, record as never);
    };
    const notifyReviewers = async (title: string, message: string): Promise<void> => {
      try {
        const reviewers = await engine.getManager<PolicyDecisionPointLike>('PolicyDecisionPoint')?.usersHolding('association-review');
        // An empty targetUsers would be every user: with nobody to tell, log only.
        if (!reviewers || reviewers.length === 0) { logger.info(`[association] Nobody holds association-review to tell: ${message}`); return; }
        await engine.getManager<NotificationManagerLike>('NotificationManager')?.addNotification({ type: 'system', level: 'info', title, message, targetUsers: reviewers });
      } catch (err) {
        logger.error(`[association] Could not tell the reviewers (${message}): ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const pdp = engine.getManager<PolicyDecisionPointLike>('PolicyDecisionPoint');
    // No decision point is a "no" (fail closed).
    const decide = async (ctx: ActorContext, request: { action: string }): Promise<Decision> =>
      pdp ? pdp.decide(ctx, request) : { permit: false, applicable: false, reason: 'no_decision_point' } as Decision;
    // Approving (#33) goes through accommodation, core's users and core's contacts, each as the reviewer.
    const users = engine.getManager<UserManagerLike>('UserManager');
    const persons = engine.getManager<PersonManagerLike>('PersonManager');
    const approval: ApprovalDoors | undefined = users && persons ? {
      searchUsers: (ctx, email) => users.searchUsers(email, { limit: 2, activeOnly: false }, ctx),
      addEntry: async (ctx, username, entry) => (await residency.changeLink(ctx, username, { op: 'add', link: entry })).at,
      removeEntry: async (ctx, username, at) => { await residency.changeLink(ctx, username, { op: 'remove', at }); },
      findPerson: async (ctx, username, email) => {
        const found = (await persons.search(ctx, email, { limit: 10 })).find(p => p.identifier === username);
        return found ? { id: found['@id'], contactPoint: found.contactPoint } : null;
      },
      updatePerson: (ctx, id, patch) => persons.update(ctx, id, patch)
    } : undefined;
    occupancy = new OccupancyManager({ db, decide, recordAudit, host, approval, checkEntry: (entry) => residency.checkEntry(entry), notifyReviewers });
    engine.registerManager('OccupancyManager', occupancy);
    unavailable = null;

    const formsData = engine.getManager<FormsDataManagerLike>('FormsDataManager');
    const formsAddon = engine.getManager<FormsAddonLike>('FormsAddon');
    if (formsData && formsAddon) {
      await formsData.registerShippedForm('association', occupancyForm, host.systemContext('association: register the Occupancy information form'));
      const manager = occupancy;
      // Kept as the person who sent it: their own context, anonymous or signed in.
      formsAddon.registerHandler(OCCUPANCY_FORM_ID, async (submission, { req }) =>
        manager.queue(host.ApiContext.from(req as never, engine as never).getActor(), submission));
    } else {
      logger.warn('[association] The forms add-on is not enabled: the Occupancy information form is not offered');
    }
    // The review page (#33): the views folder joins core's, as the forms add-on's does.
    const views = engine.app?.get?.('views') as string | string[] | undefined;
    engine.app?.set?.('views', [...[views ?? []].flat(), path.join(path.dirname(fileURLToPath(import.meta.url)), 'views')]);
    engine.app?.use('/addons/association', reviewRoutes(engine, host));
    engine.getManager<AddonsManagerLike>('AddonsManager')?.registerDashboardCard({
      addonName: 'association', title: 'Occupancy review', icon: 'fas fa-clipboard-check', adminUrl: '/addons/association/review'
    });
    logger.info(`[association] Ready, on ${accommodations.count()} accommodation(s)`);
  },

  async status(): Promise<{ healthy: boolean; message: string }> {
    if (unavailable || !accommodations || !occupancy) return { healthy: false, message: unavailable ?? 'not loaded' };
    return { healthy: true, message: `On ${accommodations.count()} accommodation(s); ${occupancy.pendingCount()} occupancy submission(s) waiting for review` };
  },

  async shutdown(): Promise<void> {
    accommodations = null;
    occupancy = null;
    unavailable = 'not registered yet';
  }
};

export default AssociationAddon;
