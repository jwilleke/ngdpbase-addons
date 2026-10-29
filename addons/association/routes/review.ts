/**
 * Occupancy review pages (#33) — mounted at /addons/association by index.ts.
 *
 *   GET  /review              the submissions waiting for review
 *   POST /review/:id/reject   reject one through its core review request; nothing is applied
 *   POST /review/:id/approve  approve one through its core review request; core runs
 *                             OccupancyManager.applyReview, which applies it as the system
 *
 * Each asks `association-review` here, OccupancyManager asks again, and core asks again and
 * records the decision (ngdpbase#2112). A refusal goes out through enforceDeny and sendApiError
 * (403); a decision refused for a reason goes back to the page with the reason.
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
        const flash = typeof req.query['flash'] === 'string' ? req.query['flash'] : '';
        const id = typeof req.query['id'] === 'string' ? req.query['id'] : '';
        // An approval's outcome, or why it was not carried out, read from core under the viewer's own check.
        const decided = (flash === 'approved' || flash === 'failed') && id ? await occupancy().decisionOf(ctx.getActor(), id) : null;
        res.render('association-review', {
          ...(await engine.templateData?.(req)),
          currentUser: req.userContext,
          submissions: await occupancy().pending(ctx.getActor()),
          flash,
          reason: decided ? (flash === 'approved' ? decided.outcome : decided.failure) ?? '' : typeof req.query['reason'] === 'string' ? req.query['reason'] : ''
        });
      } catch (err) {
        try {
          // A refusal at association's door or core's is a plain refusal, never a 500.
          if ((err as Error)?.name === 'OccupancyRefusedError' || (err as Error)?.name === 'ReviewRefusedError') {
            const refused = err as { permission: string; decision: never };
            await ApiContext.from(req, engine as never).enforceDeny(refused.permission, refused.decision);
          }
          throw err;
        } catch (answer) {
          if (answer instanceof ApiError) { sendApiError(res, answer, 'page'); return; }
          host.logger.error(`[association] The occupancy review page failed: ${answer instanceof Error ? answer.name : 'error'}`);
          res.status(500).send('Could not show the occupancy submissions');
        }
      }
    })();
  });

  /**
   * A decision on one submission, through its core review request (ngdpbase#2112): the same
   * outcome as /reviews and the Executive Hub. A refusal by policy (association's door or core's,
   * `association-review` either way) goes out through enforceDeny as a plain 403; a decision
   * refused for a reason (already decided, not found, an approval that could not be carried out)
   * goes back to the page with the reason. Anything else is a 500 and is logged.
   */
  const decide = (what: 'reject' | 'approve') =>
    (req: Request, res: Response): void => {
      void (async () => {
        const ctx = ApiContext.from(req, engine as never);
        const id = String(req.params['id']);
        try {
          await ctx.requirePermission('association-review');
          await occupancy().decide(ctx.getActor(), id, what);
          // Only the outcome code and the submission's id go in the URL; the page reads what was done from core.
          res.redirect(`/addons/association/review?flash=${what === 'reject' ? 'rejected' : `approved&id=${encodeURIComponent(id)}`}`);
        } catch (err) {
          try {
            const name = (err as Error).name;
            if (name === 'OccupancyRefusedError' || name === 'ReviewRefusedError') {
              const refused = err as { permission: string; decision: never };
              await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
            }
            // The add-on's reason can name someone: kept on the request, read back by the page, never put in the URL.
            if (name === 'ReviewHandlerFailedError') { res.redirect(`/addons/association/review?flash=failed&id=${encodeURIComponent(id)}`); return; }
            if (['OccupancyReviewError', 'ReviewNotOpenError', 'ReviewsUnavailableError'].includes(name)) {
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

  router.post('/review/:id/reject', decide('reject'));
  router.post('/review/:id/approve', decide('approve'));

  return router;
}
