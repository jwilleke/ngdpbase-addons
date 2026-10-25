/**
 * Accommodation admin pages — mounted at /addons/accommodation by index.ts.
 *
 *   GET  /residents                  every accommodation with its current owners and occupants
 *   GET  /residents/:parcel          one accommodation: every owner and occupant entry, past and present
 *   POST /residents/:parcel/change   add, end, correct or remove one entry (#28)
 *   GET  /mine                       a signed-in resident's own units (#36), under accommodation-self
 *   POST /mine/:parcel/billing/:index an owner sets the address of a billing party they are on (#38)
 *   POST /mine/:parcel/occupant-end  an owner ends an occupant's entry on their unit (#37)
 *
 * Seeing them asks `accommodation-read`; a change asks `accommodation-manage` here, and
 * ResidencyManager asks again at its door, records the change and writes it through
 * UserManager. A refusal goes out through enforceDeny and sendApiError; a change refused for
 * a reason (a bad date, an unknown person) goes back to the page with the reason.
 */
import type { Request, Response, Router } from 'express';
import type { AddonHost } from '@jwilleke/ngdpbase-types';
import type AccommodationManager from '../managers/AccommodationManager.js';
import type ResidencyManager from '../managers/ResidencyManager.js';
import type { LinkChange, LinkChangeResult } from '../managers/ResidencyManager.js';
import type { LinkType, UnitLink } from '../managers/unitLinks.js';
import { unitAddress } from '../managers/billing.js';

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  createRouter(): Router;
  templateData?: (req: Request) => Promise<Record<string, unknown>>;
}

/** A form value as a trimmed string; anything else is empty. */
function text(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === 'string' ? value.trim() : '';
}

/** The link a form describes. Nothing is guessed: the manager refuses what does not read as a link. */
function linkFrom(body: Record<string, unknown>, parcel: string): UnitLink {
  const type = text(body, 'type') as LinkType;
  const share = text(body, 'share');
  return {
    parcel, type, from: text(body, 'from'), to: text(body, 'to'),
    ...(type === 'owner' ? { share: share === '' ? Number.NaN : Number(share) } : {})
  };
}

/** The change a form posts. An unknown `op` is refused by name. */
function changeFrom(body: Record<string, unknown>, parcel: string): LinkChange | string {
  const op = text(body, 'op');
  const at = { type: text(body, 'type') as LinkType, index: Number(text(body, 'index')), expected: typeof body['expected'] === 'string' ? body['expected'] : '' };
  switch (op) {
    case 'add': return { op, link: linkFrom(body, parcel) };
    case 'correct': return { op, at, link: linkFrom(body, parcel) };
    case 'end': return { op, at, on: text(body, 'on') };
    case 'remove': return { op, at };
    default: return `unknown change "${op}"`;
  }
}

/** Where to go after a change, with what to tell the admin. */
function afterChange(parcel: string, result: LinkChangeResult): string {
  return `/addons/accommodation/residents/${encodeURIComponent(parcel)}?flash=${result.changed ? 'saved' : 'unchanged'}`;
}

export default function adminRoutes(engine: Engine, host: AddonHost): Router {
  const { ApiContext, ApiError, sendApiError } = host;
  const router = engine.createRouter();
  const managers = (): { accommodations: AccommodationManager; residency: ResidencyManager } => {
    const accommodations = engine.getManager<AccommodationManager>('AccommodationManager');
    const residency = engine.getManager<ResidencyManager>('ResidencyManager');
    if (!accommodations || !residency) throw new Error('the accommodation managers are not loaded');
    return { accommodations, residency };
  };

  router.get('/residents', (req: Request, res: Response) => {
    void (async () => {
      try {
        const ctx = ApiContext.from(req, engine as never);
        await ctx.requirePermission('accommodation-read');
        const { accommodations, residency } = managers();
        const actor = ctx.getActor();
        const units = accommodations.list();
        const roster = await residency.roster(actor, units.map(u => u.id));
        res.render('accommodation-residents', {
          ...(await engine.templateData?.(req)),
          currentUser: req.userContext,
          units: units.map(u => ({ id: u.id, ...(roster.get(u.id) ?? { owners: [], occupants: [] }) })),
          problems: await residency.linkProblems(actor)
        });
      } catch (err) {
        if (err instanceof ApiError) { sendApiError(res, err, 'page'); return; }
        res.status(500).send('Could not show the owners and occupants');
      }
    })();
  });

  router.get('/residents/:parcel', (req: Request, res: Response) => {
    void (async () => {
      try {
        const ctx = ApiContext.from(req, engine as never);
        await ctx.requirePermission('accommodation-read');
        const { accommodations, residency } = managers();
        const parcel = String(req.params['parcel']);
        if (!accommodations.get(parcel)) { res.status(404).send('No such accommodation'); return; }
        const actor = ctx.getActor();
        const { entries, shareProblems } = await residency.unitEntries(actor, parcel);
        res.render('accommodation-resident-unit', {
          ...(await engine.templateData?.(req)),
          currentUser: req.userContext,
          parcel,
          entries,
          shareProblems,
          people: await residency.people(actor),
          flash: typeof req.query['flash'] === 'string' ? req.query['flash'] : '',
          reason: typeof req.query['reason'] === 'string' ? req.query['reason'] : ''
        });
      } catch (err) {
        if (err instanceof ApiError) { sendApiError(res, err, 'page'); return; }
        res.status(500).send('Could not show the accommodation');
      }
    })();
  });

  router.post('/residents/:parcel/change', (req: Request, res: Response) => {
    void (async () => {
      const ctx = ApiContext.from(req, engine as never);
      const parcel = String(req.params['parcel']);
      const back = `/addons/accommodation/residents/${encodeURIComponent(parcel)}`;
      try {
        await ctx.requirePermission('accommodation-manage');
        const body = (req.body ?? {}) as Record<string, unknown>;
        const change = changeFrom(body, parcel);
        if (typeof change === 'string') { res.redirect(`${back}?flash=refused&reason=${encodeURIComponent(change)}`); return; }
        const result = await managers().residency.changeLink(ctx.getActor(), text(body, 'username'), change);
        res.redirect(afterChange(parcel, result));
      } catch (err) {
        try {
          if ((err as Error).name === 'AccommodationRefusedError') {
            const refused = err as { permission: string; decision: never };
            await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
          }
          if ((err as Error).name === 'LinkChangeRefusedError') {
            res.redirect(`${back}?flash=refused&reason=${encodeURIComponent((err as Error).message)}`);
            return;
          }
          throw err;
        } catch (answer) {
          if (answer instanceof ApiError) { sendApiError(res, answer, 'page'); return; }
          host.logger.error(`[accommodation] A change to ${parcel} failed: ${answer instanceof Error ? answer.message : String(answer)}`);
          res.status(500).send('The change was not saved');
        }
      }
    })();
  });

  // A resident's own units (#36). ResidencyManager.ownUnits decides again and returns only what
  // this viewer may see; the accommodation's own address and assessment are not about anyone.
  router.get('/mine', (req: Request, res: Response) => {
    void (async () => {
      const ctx = ApiContext.from(req, engine as never);
      try {
        await ctx.requirePermission('accommodation-self');
        const { accommodations, residency } = managers();
        // Money is shown by core's one formatter, in the site's currency.
        const formatMoney = engine.getManager<{ formatters: { formatMoney(minor: number, currency: string): string } }>('PluginManager')?.formatters.formatMoney;
        const configured = engine.getManager<{ getProperty(key: string, fallback?: unknown): unknown }>('ConfigurationManager')?.getProperty('ngdpbase.default.currency', 'USD');
        const currency = typeof configured === 'string' && configured !== '' ? configured : 'USD';
        const units = (await residency.ownUnits(ctx.getActor())).map(u => {
          const assessment = accommodations.assessment(u.id);
          return {
            ...u,
            address: unitAddress(accommodations.get(u.id))?.streetAddress ?? u.id,
            category: accommodations.category(u.id)?.name ?? null,
            assessment: assessment && formatMoney ? { amount: formatMoney(assessment.amount, currency), period: assessment.period } : null
          };
        });
        res.render('accommodation-mine', {
          ...(await engine.templateData?.(req)), currentUser: req.userContext, units,
          flash: typeof req.query['flash'] === 'string' ? req.query['flash'] : '',
          reason: typeof req.query['reason'] === 'string' ? req.query['reason'] : ''
        });
      } catch (err) {
        try {
          if ((err as Error).name === 'AccommodationRefusedError') {
            const refused = err as { permission: string; decision: never };
            await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
          }
          throw err;
        } catch (answer) {
          if (answer instanceof ApiError) { sendApiError(res, answer, 'page'); return; }
          res.status(500).send('Could not show your accommodation');
        }
      }
    })();
  });

  router.post('/mine/:parcel/occupant-end', (req: Request, res: Response) => {
    void (async () => {
      const ctx = ApiContext.from(req, engine as never);
      try {
        await ctx.requirePermission('accommodation-self');
        const body = (req.body ?? {}) as Record<string, unknown>;
        const at = { type: 'occupant' as const, index: Number(text(body, 'index')), expected: typeof body['expected'] === 'string' ? body['expected'] : '' };
        // changeLink decides whether this caller may end it as an owner of its unit.
        await managers().residency.changeLink(ctx.getActor(), text(body, 'username'), { op: 'end', at, on: text(body, 'on') });
        res.redirect('/addons/accommodation/mine?flash=occupant-ended');
      } catch (err) {
        try {
          if ((err as Error).name === 'AccommodationRefusedError') {
            const refused = err as { permission: string; decision: never };
            await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
          }
          if ((err as Error).name === 'LinkChangeRefusedError') {
            res.redirect(`/addons/accommodation/mine?flash=refused&reason=${encodeURIComponent((err as Error).message)}`);
            return;
          }
          throw err;
        } catch (answer) {
          if (answer instanceof ApiError) { sendApiError(res, answer, 'page'); return; }
          host.logger.error(`[accommodation] An owner's occupant end failed: ${answer instanceof Error ? answer.message : String(answer)}`);
          res.status(500).send('The occupant was not ended');
        }
      }
    })();
  });

  router.post('/mine/:parcel/billing/:index', (req: Request, res: Response) => {
    void (async () => {
      const ctx = ApiContext.from(req, engine as never);
      try {
        await ctx.requirePermission('accommodation-self');
        const body = (req.body ?? {}) as Record<string, unknown>;
        await managers().residency.setBillingAddress(ctx.getActor(), String(req.params['parcel']), Number(req.params['index']), {
          streetAddress: text(body, 'streetAddress'), addressLocality: text(body, 'addressLocality'),
          addressRegion: text(body, 'addressRegion'), postalCode: text(body, 'postalCode')
        });
        res.redirect('/addons/accommodation/mine?flash=billing-saved');
      } catch (err) {
        try {
          if ((err as Error).name === 'AccommodationRefusedError') {
            const refused = err as { permission: string; decision: never };
            await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
          }
          if ((err as Error).name === 'LinkChangeRefusedError') {
            res.redirect(`/addons/accommodation/mine?flash=refused&reason=${encodeURIComponent((err as Error).message)}`);
            return;
          }
          throw err;
        } catch (answer) {
          if (answer instanceof ApiError) { sendApiError(res, answer, 'page'); return; }
          host.logger.error(`[accommodation] A billing address change failed: ${answer instanceof Error ? answer.message : String(answer)}`);
          res.status(500).send('The billing address was not saved');
        }
      }
    })();
  });

  return router;
}
