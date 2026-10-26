/**
 * Accommodation add-on for ngdpbase: accommodations (schema.org `Accommodation`), keyed by
 * the county parcel, and their owners and occupants (epic
 * https://github.com/jwilleke/ngdpbase-addons/issues/19). The Fairways Condominiums is the
 * reference site; nothing here is condo-only, so a landlord can use it too.
 *
 * register() registers AccommodationManager, ResidencyManager and the [{Accommodation}]
 * plugin, mounts the API at /api/accommodation and the admin pages at /addons/accommodation
 * (who owns and lives in each accommodation, #28), sets the `accommodation` capability, and
 * registers the daily job `accommodation.roles`, which keeps the `owner` and `occupant`
 * roles in step with the dated ownership and occupancy entries (#23).
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
import adminRoutes from './routes/admin.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AccommodationManager, { createProvider, type AccommodationAuditRecord, type Decide } from './managers/AccommodationManager.js';
import ResidencyManager, { OWNERSHIP_REQUEST, type RoleDoor, type UserRecord } from './managers/ResidencyManager.js';
import { categoriesFrom } from './managers/categories.js';
import { lateChargesFrom } from './managers/lateCharges.js';
import { chargeLinesFrom } from './managers/chargeLines.js';
import AccommodationPlugin from './plugins/AccommodationPlugin.js';

interface PluginManagerLike { registerPlugin(name: string, plugin: unknown): Promise<void> }
interface ConfigurationManagerLike { resolveDataPath(p: string): string }
interface CacheManagerLike { bump(topic: string): Promise<unknown> }
interface PolicyDecisionPointLike {
  decide(subject: unknown, request: { action: string }): Promise<Decision>;
  usersHolding(action: string): Promise<string[] | null>;
}
interface NotificationManagerLike {
  addNotification(n: { type: 'system'; level: 'info'; title: string; message: string; targetUsers: string[] }): Promise<string>;
}
interface RoleManagerLike {
  hasRole(ctx: ActorContext, username: string, roleName: string): Promise<boolean>;
  assignRole(username: string, roleName: string, ctx: ActorContext): Promise<boolean>;
  removeRole(username: string, roleName: string, ctx: ActorContext): Promise<boolean>;
}
interface BackgroundJobManagerLike {
  registerJob(def: {
    id: string; displayName: string; schedule: string; catchUp: 'latest';
    run(reportProgress: (message: string) => void, ctx: ActorContext): Promise<{ success: boolean; summary?: string; error?: string }>;
  }): void;
  enqueue(jobId: string, requestedBy: ReturnType<AddonHost['jobContextFromRequest']>): Promise<string>;
}
interface UserManagerLike {
  searchUsers(query: string, options: { limit?: number; activeOnly?: boolean }, ctx: ActorContext): Promise<UserRecord[]>;
  updateUser(username: string, updates: (current: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>, ctx: ActorContext): Promise<unknown>;
  createUser(user: { username: string; email?: string; displayName: string }, ctx: ActorContext): Promise<{ username: string }>;
}
interface AuthManagerLike {
  inviteUser(ctx: ActorContext, username: string): Promise<{ outcome: string; reason?: string }>;
}
interface IdentityManagerLike {
  getByUserIdentifier(ctx: ActorContext, username: string): Promise<{ '@id': string; contactPoint?: unknown[] } | null>;
  update(ctx: ActorContext, id: string, patch: Record<string, unknown>): Promise<unknown>;
}
interface AddonsManagerLike {
  registerDashboardCard(card: { addonName: string; title: string; icon: string; adminUrl: string }): void;
}

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  registerManager(name: string, manager: unknown): void;
  setCapability(id: string, enabled: boolean): void;
  app?: { use(route: string, handler: unknown): void; get?(setting: string): unknown; set?(setting: string, value: unknown): void };
  createRouter(): import('express').Router;
  templateData?: (req: import('express').Request) => Promise<Record<string, unknown>>;
}

let accommodations: AccommodationManager | null = null;
let residency: ResidencyManager | null = null;
let statusContext: (() => ActorContext) | null = null;

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
    // No decision point is a "no" (fail closed).
    const decide: Decide = async (subject, request) => pdp ? pdp.decide(subject, request) : { permit: false, applicable: false, reason: 'no_decision_point' } as Decision;
    // accommodation-manage is a refuse event: a record that cannot be written throws here, and the change stops.
    const recordAudit = async (record: AccommodationAuditRecord): Promise<void> => {
      await host.recordAuditEvent(auditSink, { result: 'success', ...record } as never);
    };
    accommodations = new AccommodationManager({
      host,
      decide,
      recordAudit,
      provider: await createProvider(providerName, dataPath),
      categories: categoriesFrom(config['categories']),
      lateCharges: lateChargesFrom(config['late-charges']),
      chargeLines: chargeLinesFrom(config['charge-lines']),
      bump: () => engine.getManager<CacheManagerLike>('CacheManager')?.bump('AccommodationManager') ?? Promise.resolve(),
      // One change at a time, from read to save (#39).
      serial: host.keyedSerial()
    });
    await accommodations.initialize();
    engine.registerManager('AccommodationManager', accommodations);

    // The owner and occupant roles follow the facts (#23): the job below is the one place they change.
    const roleManager = engine.getManager<RoleManagerLike>('RoleManager');
    const jobs = engine.getManager<BackgroundJobManagerLike>('BackgroundJobManager');
    const rolesJob = roleManager && jobs ? jobs : null;

    const accommodationManager = accommodations;
    const userManager = (): UserManagerLike => {
      const users = engine.getManager<UserManagerLike>('UserManager');
      if (!users) throw new Error('UserManager is not available');
      return users;
    };
    residency = new ResidencyManager({
      // Every user, inactive ones too: an owner whose account is off still owes.
      users: async (ctx) => (await engine.getManager<UserManagerLike>('UserManager')?.searchUsers('', { limit: 0, activeOnly: false }, ctx)) ?? [],
      accommodation: (id) => accommodationManager.get(id),
      // A resident's own page (#36): decided with their context, then read as the system with a reason.
      decide,
      // Occupants' contact details for their owner (#37), through core's IdentityManager once the door has decided.
      identities: {
        // The account's own identity record, by the guide's door for it.
        find: async (systemCtx, username) => {
          const found = await engine.getManager<IdentityManagerLike>('IdentityManager')?.getByUserIdentifier(systemCtx, username);
          return found ? { id: found['@id'], contactPoint: found.contactPoint } : null;
        },
        update: async (systemCtx, id, patch) => {
          const identities = engine.getManager<IdentityManagerLike>('IdentityManager');
          if (!identities) throw new Error('IdentityManager is not available');
          return identities.update(systemCtx, id, patch);
        }
      },
      systemContext: (reason) => host.systemContext(reason),
      // An owner's request to change the owners goes to core's reviews for the Board (#40).
      reviews: host.reviews,
      // The admin page's changes (#28): the entries are written onto the account through UserManager.
      changes: {
        decide, recordAudit, host,
        updateUser: (username, update, ctx) => userManager().updateUser(username, update, ctx),
        // An owner's new occupant with no account (#37): made with no password and invited, as the system.
        createUser: (ctx, user) => userManager().createUser(user, ctx),
        inviteUser: async (systemCtx, username) => {
          const auth = engine.getManager<AuthManagerLike>('AuthManager');
          return auth ? auth.inviteUser(systemCtx, username) : { outcome: 'not-sent', reason: 'AuthManager is not available' };
        },
        // An owner's billing address (#38): written as the system, after the owner's own decision and record.
        writeBilling: (systemCtx, id, billing) => accommodationManager.update(systemCtx, id, current => ({ ...current, billing })),
        notify: async (title, message) => {
          try {
            const holders = await pdp?.usersHolding('accommodation-notices');
            // An empty targetUsers would be every user: with nobody to tell, log only.
            if (!holders || holders.length === 0) { host.logger.info(`[accommodation] Nobody holds accommodation-notices to tell: ${message}`); return; }
            await engine.getManager<NotificationManagerLike>('NotificationManager')?.addNotification({ type: 'system', level: 'info', title, message, targetUsers: holders });
          } catch (err) {
            host.logger.error(`[accommodation] Could not send a notice (${message}): ${err instanceof Error ? err.message : String(err)}`);
          }
        },
        // The roles job runs now, as the admin who made the change; the job manager retries,
        // records and reports it. A job that cannot even start is logged; the daily run follows.
        ...(rolesJob ? {
          followRoles: async (ctx: ActorContext) => {
            try {
              await rolesJob.enqueue('accommodation.roles', host.jobContextFromRequest(ctx as never));
            } catch (err) {
              host.logger.error(`[accommodation] The roles job could not be started after a change by ${ctx.username}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } : {})
      }
    });
    engine.registerManager('ResidencyManager', residency);
    // Carries out an approved request to change the owners (#40), as the reviewer. Registered on
    // every start, so a site that turns reviews on later works.
    const reviewed = residency;
    try {
      host.registerReviewHandler(OWNERSHIP_REQUEST, (request, ctx) => reviewed.applyOwnershipRequest(ctx, request));
    } catch (err) {
      host.logger.warn(`[accommodation] Owners' requests to change the owners cannot be approved here: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Billing kept in the earlier shape (owners named, a structured address) becomes billing entries,
    // once (ngdpbase#2042): each unit in its own write, under the system context; counts only in the log.
    try {
      const converted = await residency.convertBilling(
        host.systemContext('accommodation: convert billing to billing entries (ngdpbase#2042)'),
        accommodationManager.list().map(a => a.id));
      if (converted.converted > 0 || converted.untouched.length > 0) {
        host.logger.info(`[accommodation] Billing converted on ${converted.converted} accommodation(s); ${converted.untouched.length} left as they are because they name a username with no account (the treasurer fixes those on the unit's page).`);
      }
    } catch (err) {
      host.logger.error(`[accommodation] Billing could not be converted: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Every ownership entry names its ownership period (#43): entries saved before get one, once,
    // under the system context; a unit's current owners share one. Counts only in the log.
    try {
      const tagged = await residency.tagPeriods(host.systemContext('accommodation: give ownership entries their period (#43)'));
      if (tagged.tagged > 0) host.logger.info(`[accommodation] Ownership periods given to ${tagged.tagged} ownership entr(ies) on ${tagged.accounts} account(s).`);
    } catch (err) {
      host.logger.error(`[accommodation] Ownership periods could not be given: ${err instanceof Error ? err.message : String(err)}`);
    }
    statusContext = () => host.systemContext('accommodation: status, accommodations with no current owner');

    // The roles job: a change on the admin page starts it at once (above); every day it gives
    // and takes the roles the dates bring, and a missed day runs at start-up.
    if (roleManager && jobs) {
      const roles: RoleDoor = {
        holds: (ctx, username, role) => roleManager.hasRole(ctx, username, role),
        assign: async (username, role, ctx) => { await roleManager.assignRole(username, role, ctx); },
        remove: async (username, role, ctx) => { await roleManager.removeRole(username, role, ctx); }
      };
      const residencyManager = residency;
      jobs.registerJob({
        id: 'accommodation.roles',
        displayName: 'Accommodation: owner and occupant roles follow the dated entries',
        schedule: 'daily 00:05',
        catchUp: 'latest',
        run: async (reportProgress, ctx) => {
          const { assigned, removed, leftAlone, failed } = await residencyManager.reconcileRoles(ctx, roles);
          const summary = `${assigned.length} role(s) assigned, ${removed.length} removed, ${leftAlone.length} left alone (unreadable entries)`;
          reportProgress(summary);
          if (failed.length === 0) return { success: true, summary };
          // A refused change fails the run, so the job manager retries it, audits it and tells the admins.
          const refused = failed.map(f => `${f.change} ${f.role} for ${f.username}: ${f.error}`).join('; ');
          return { success: false, summary, error: `${failed.length} role change(s) refused: ${refused}` };
        }
      });
    } else {
      host.logger.warn('[accommodation] No RoleManager or BackgroundJobManager: the owner and occupant roles are not kept in step');
    }
    host.logger.info(`[accommodation] Accommodations from provider '${accommodations.providerName}': ${accommodations.count()}`);

    await engine.getManager<PluginManagerLike>('PluginManager')?.registerPlugin('Accommodation', AccommodationPlugin);

    engine.app?.use('/api/accommodation', apiRoutes(engine, host));
    // The admin pages (#28): the views folder joins core's, as the forms add-on's does.
    const views = engine.app?.get?.('views') as string | string[] | undefined;
    engine.app?.set?.('views', [...[views ?? []].flat(), path.join(path.dirname(fileURLToPath(import.meta.url)), 'views')]);
    engine.app?.use('/addons/accommodation', adminRoutes(engine, host));
    engine.getManager<AddonsManagerLike>('AddonsManager')?.registerDashboardCard({
      addonName: 'accommodation', title: 'Owners and occupants', icon: 'fas fa-house-user', adminUrl: '/addons/accommodation/residents'
    });
    engine.setCapability('accommodation', true);
  },

  /**
   * How many accommodations are loaded, and which have no current owner: worked out from the
   * dated ownership entries each time it is asked, never stored or scheduled (operator,
   * 2026-10-23, https://github.com/jwilleke/ngdpbase-addons/issues/21).
   */
  async status(): Promise<{ healthy: boolean; records: number; message: string }> {
    if (!accommodations || !residency || !statusContext) return { healthy: false, records: 0, message: '0 accommodation(s) loaded' };
    const count = accommodations.count();
    const loaded = `${count} accommodation(s) loaded`;
    const ids = accommodations.list().map(a => a.id);
    const none = await residency.withoutOwner(statusContext(), ids);
    // Units that block invoicing (ngdpbase#2042): shown here, on the /admin card, before a dues run.
    const unbilled = residency.withoutBilling(ids);
    const notes = [
      ...(none.length > 0 ? [`${none.length} with no current owner: ${none.join(', ')}`] : []),
      ...(unbilled.length > 0 ? [`${unbilled.length} with no usable billing address (they cannot be invoiced)`] : [])
    ];
    return { healthy: true, records: count, message: [loaded, ...notes].join('; ') };
  },

  async shutdown(): Promise<void> {
    accommodations = null;
    residency = null;
    statusContext = null;
  }
};

export default AccommodationAddon;
