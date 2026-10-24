/**
 * Occupancy review pages (#33) — mounted at /addons/association by index.ts.
 *
 *   GET  /review              the submissions waiting for review
 *   POST /review/:id/reject   refuse one; nothing is applied
 *   POST /review/:id/approve  apply one for the person with its email (an owner's share in `share`)
 *
 * Each asks `association-review` here, and OccupancyManager asks again at its door and records
 * the decision. A refusal goes out through enforceDeny and sendApiError; a review refused for
 * a reason (already decided, not found) goes back to the page with the reason.
 */
import type { Request, Response, Router } from 'express';
import type { AddonHost } from '@jwilleke/ngdpbase-types';
import type OccupancyManager from '../managers/OccupancyManager.js';

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  createRouter(): Router;
  templateData?: (req: Request) => Promise<Record<string, unknown>>;
}

export default function reviewRoutes(engine: Engine, host: AddonHost): Router {
  const { ApiContext, ApiError, sendApiError } = host;
  const router = engine.createRouter();
  const occupancy = (): OccupancyManager => {
    const manager = engine.getManager<OccupancyManager>('OccupancyManager');
    if (!manager) throw new Error('OccupancyManager is not loaded');
    return manager;
  };

  router.get('/review', (req: Request, res: Response) => {
    void (async () => {
      try {
        const ctx = ApiContext.from(req, engine as never);
        await ctx.requirePermission('association-review');
        res.render('association-review', {
          ...(await engine.templateData?.(req)),
          currentUser: req.userContext,
          submissions: await occupancy().pending(ctx.getActor()),
          flash: typeof req.query['flash'] === 'string' ? req.query['flash'] : '',
          reason: typeof req.query['reason'] === 'string' ? req.query['reason'] : ''
        });
      } catch (err) {
        if (err instanceof ApiError) { sendApiError(res, err, 'page'); return; }
        res.status(500).send('Could not show the occupancy submissions');
      }
    })();
  });

  /** A decision on one submission: refusals by policy through enforceDeny, refusals for a reason back to the page. */
  const decide = (what: 'reject' | 'approve', act: (ctx: ReturnType<typeof ApiContext.from>, req: Request) => Promise<string>) =>
    (req: Request, res: Response): void => {
      void (async () => {
        const ctx = ApiContext.from(req, engine as never);
        try {
          await ctx.requirePermission('association-review');
          res.redirect(`/addons/association/review?flash=${await act(ctx, req)}`);
        } catch (err) {
          try {
            const name = (err as Error).name;
            // association's own door (association-review) and accommodation's (accommodation-manage)
            if (name === 'OccupancyRefusedError' || name === 'AccommodationRefusedError') {
              const refused = err as { permission: string; decision: never };
              await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
            }
            if (name === 'OccupancyReviewError' || name === 'LinkChangeRefusedError') {
              res.redirect(`/addons/association/review?flash=refused&reason=${encodeURIComponent((err as Error).message)}`);
              return;
            }
            throw err;
          } catch (answer) {
            if (answer instanceof ApiError) { sendApiError(res, answer, 'page'); return; }
            const why = answer instanceof Error ? answer.message : String(answer);
            host.logger.error(`[association] An occupancy ${what} failed: ${why}`);
            res.status(500).send(`Not ${what === 'reject' ? 'rejected' : 'approved'}: ${why}`);
          }
        }
      })();
    };

  router.post('/review/:id/reject', decide('reject', async (ctx, req) => {
    await occupancy().reject(ctx.getActor(), String(req.params['id']));
    return 'rejected';
  }));

  router.post('/review/:id/approve', decide('approve', async (ctx, req) => {
    const share = typeof (req.body as Record<string, unknown>)?.['share'] === 'string' ? Number((req.body as Record<string, string>)['share']) : undefined;
    const { username } = await occupancy().approve(ctx.getActor(), String(req.params['id']), { share });
    return `approved&reason=${encodeURIComponent(username)}`;
  }));

  return router;
}
