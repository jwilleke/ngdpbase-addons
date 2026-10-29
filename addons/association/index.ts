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
 * add-on and registers its handler, which keeps every submission in the add-on's encrypted
 * database (OccupancyManager) and files it with core's reviews for the holders of
 * `association-review` (ngdpbase#2112); its review handler applies an approved one as the system.
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
import OccupancyManager, { OCCUPANCY_REVIEW, type ApprovalDoors, type EntryRef, type IdentityDoors, type OccupancyAuditRecord, type OccupancyDb, type OccupancyManagerOptions, type OccupancySubmission } from './managers/OccupancyManager.js';
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
  contactDetails: ApprovalDoors['contactDetails'];
  changeLink(ctx: ActorContext, username: string, change: unknown): Promise<{ changed: boolean; at?: EntryRef }>;
}
interface UserManagerLike {
  searchUsers(query: string, options: { limit?: number; activeOnly?: boolean }, ctx: ActorContext): Promise<Array<{ username: string; email?: string }>>;
  createUser(user: { username: string; email: string; displayName: string }, ctx: ActorContext): Promise<{ username: string }>;
}
interface AuthManagerLike {
  inviteUser(ctx: ActorContext, username: string): Promise<{ outcome: string; reason?: string }>;
}
interface IdentityManagerLike {
  getByUserIdentifier(ctx: ActorContext, username: string): Promise<{ '@id': string; contactPoint?: unknown[] } | null>;
  update(ctx: ActorContext, id: string, patch: Record<string, unknown>): Promise<unknown>;
  /** #2041, ngdpbase 5.34.0: the @id behind a username, or null (no account, or a store that cannot answer). */
  identityIdOf: IdentityDoors['identityIdOf'];
  canAnswer: IdentityDoors['canAnswer'];
  convertReference: IdentityDoors['convertReference'];
}
interface DatabaseManagerLike {
  isEnabled(): boolean;
  openAddonDatabase<Handle>(owner: string, options: { migrations: unknown[]; ledgerTable: string }): Handle;
}
interface PolicyDecisionPointLike {
  decide(ctx: ActorContext, request: { action: string }): Promise<Decision>;
}
interface AddonsManagerLike {
  registerDashboardCard(card: {
    addonName: string; title: string; icon: string; adminUrl: string;
    /** ngdpbase#2093: an Executive Hub card, shown to a viewer the PDP permits `permission`. */
    surface?: 'admin' | 'executive'; permission?: string;
    summary?: (ctx: ActorContext) => Promise<{ figures: Array<{ label: string; value: number | string }>; message?: string }>;
  }): void;
  /** Present on a core with the Executive Hub (ngdpbase#2093). */
  executiveCardsFor?: unknown;
}
interface FormsDataManagerLike { registerShippedForm(addon: string, definition: unknown, ctx: ActorContext): Promise<string> }
interface FormsAddonLike {
  registerHandler(formId: string, handler: (submission: OccupancySubmission, context: { engine: unknown; req: unknown }) => Promise<unknown>): void;
}

let accommodations: AccommodationManagerLike | null = null;
let occupancy: OccupancyManager | null = null;
let unavailable: string | null = 'not registered yet';
/** Set while the start-up conversion of stored submitters is postponed or has orphans (#2042); counts only. */
let attention: string | null = null;

const AssociationAddon = {
  name: 'association',
  version: '0.3.0',
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

    const pdp = engine.getManager<PolicyDecisionPointLike>('PolicyDecisionPoint');
    // No decision point is a "no" (fail closed).
    const decide = async (ctx: ActorContext, request: { action: string }): Promise<Decision> =>
      pdp ? pdp.decide(ctx, request) : { permit: false, applicable: false, reason: 'no_decision_point' } as Decision;
    // Approving (#33) goes through accommodation, core's users and core's contacts, each under the
    // system context applyReview gives it, with the decider in its reason (ngdpbase#2112).
    const users = engine.getManager<UserManagerLike>('UserManager');
    const persons = engine.getManager<IdentityManagerLike>('IdentityManager');
    const approval: ApprovalDoors | undefined = users && persons ? {
      searchUsers: (ctx, email) => users.searchUsers(email, { limit: 2, activeOnly: false }, ctx),
      usernameTaken: async (ctx, username) => (await users.searchUsers(username, { limit: 0, activeOnly: false }, ctx))
        .some(u => u.username.toLowerCase() === username.toLowerCase()),
      addEntry: async (ctx, username, entry) => (await residency.changeLink(ctx, username, { op: 'add', link: entry })).at,
      removeEntry: async (ctx, username, at) => { await residency.changeLink(ctx, username, { op: 'remove', at }); },
      // The account's own identity record.
      findPerson: async (ctx, username) => {
        const found = await persons.getByUserIdentifier(ctx, username);
        return found ? { id: found['@id'], contactPoint: found.contactPoint } : null;
      },
      updatePerson: (ctx, id, patch) => persons.update(ctx, id, patch),
      contactDetails: (answers) => residency.contactDetails(answers),
      // Someone with no account (#34): made with no password, then invited.
      createUser: (ctx, user) => users.createUser(user, ctx),
      inviteUser: async (ctx, username) => {
        const auth = engine.getManager<AuthManagerLike>('AuthManager');
        return auth ? auth.inviteUser(ctx, username) : { outcome: 'not-sent', reason: 'AuthManager is not available' };
      }
    } : undefined;
    occupancy = new OccupancyManager({ db, decide, recordAudit, host, approval, checkEntry: (entry) => residency.checkEntry(entry),
      // Every submission is filed and decided with core's reviews (ngdpbase#2112).
      reviews: host.reviews,
      systemContext: (reason) => host.systemContext(reason),
      ...(persons ? { identities: {
        identityIdOf: (ctx, username) => persons.identityIdOf(ctx, username),
        canAnswer: () => persons.canAnswer(),
        convertReference: (ctx, stored) => persons.convertReference(ctx, stored)
      } } : {}) });
    engine.registerManager('OccupancyManager', occupancy);
    // Carries out an approved occupancy request, as the system, naming the decider (ngdpbase#2112).
    // Registered on every start, before anything is filed, so a site that turns reviews on later works.
    const applying = occupancy;
    host.registerReviewHandler(OCCUPANCY_REVIEW, (request, ctx) => applying.applyReview(ctx, request));
    // Stored submitters that are still usernames become identity @ids, once (#2042).
    attention = null;
    if (persons) {
      const done = await occupancy.convertSubmitters();
      if (done.postponed) {
        attention = 'submitters not converted to identity @ids: identity store unavailable, conversion postponed to the next start';
        logger.warn(`[association] ${attention}`);
      } else {
        if (done.converted > 0) logger.info(`[association] Converted ${done.converted} submitter(s) from username to identity @id`);
        if (done.orphans > 0) {
          attention = `${done.orphans} submission(s) are orphaned: their submitter's username has no account`;
          logger.warn(`[association] ${attention}`);
        }
      }
    }
    // Submissions kept before reviews are filed now, once each, under the system context (ngdpbase#2112).
    const waiting = await occupancy.fileWaiting();
    if (waiting.filed > 0) logger.info(`[association] Filed ${waiting.filed} occupancy submission(s) kept before core's reviews for review`);
    if (waiting.postponed) {
      const note = 'occupancy submissions kept before core\'s reviews are not filed for review yet: retried when the review page opens and at the next start';
      attention = attention ? `${attention}; ${note}` : note;
      logger.warn(`[association] ${note}`);
    }
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
    const addons = engine.getManager<AddonsManagerLike>('AddonsManager');
    addons?.registerDashboardCard({
      addonName: 'association', title: 'Occupancy review', icon: 'fas fa-clipboard-check', adminUrl: '/addons/association/review'
    });
    // The board's card on the Executive Hub (ngdpbase#2094): the forms waiting, counted for the viewer.
    // Only on a core that has the hub: an older one keys cards by add-on alone, so this would replace the /admin one.
    if (addons && typeof addons.executiveCardsFor === 'function') {
      const manager = occupancy;
      addons.registerDashboardCard({
        addonName: 'association', title: 'Occupancy review', icon: 'fas fa-clipboard-check', adminUrl: '/addons/association/review',
        surface: 'executive', permission: 'association-review',
        summary: async (ctx) => ({ figures: [{ label: 'Occupancy forms waiting', value: await manager.waitingCount(ctx) }] })
      });
    }
    logger.info(`[association] Ready, on ${accommodations.count()} accommodation(s)`);
  },

  async status(): Promise<{ healthy: boolean; message: string }> {
    if (unavailable || !accommodations || !occupancy) return { healthy: false, message: unavailable ?? 'not loaded' };
    return { healthy: true, message: `On ${accommodations.count()} accommodation(s); ${occupancy.pendingCount()} occupancy submission(s) waiting for review${attention ? `; ${attention}` : ''}` };
  },

  async shutdown(): Promise<void> {
    accommodations = null;
    occupancy = null;
    unavailable = 'not registered yet';
    attention = null;
  }
};

export default AssociationAddon;
