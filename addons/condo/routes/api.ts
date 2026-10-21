/**
 * Condo API — mounted at /api/condo by index.ts.
 *
 * Every restricted route asks its permission on the request's own ApiContext;
 * a refusal goes out through sendApiError. No role name, no session read.
 * Core values come from the `host` ngdpbase hands register() (#1813); only
 * types are imported from core.
 */
import type { Request, Response, Router } from 'express';
import type { AddonHost } from '@jwilleke/ngdpbase-types';
import type CondoUnitManager from '../managers/CondoUnitManager.js';

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  /** A Router from ngdpbase's own Express (#1861); add-ons never import express at runtime. */
  createRouter(): Router;
}

export default function apiRoutes(engine: Engine, host: AddonHost): Router {
  const { ApiContext, ApiError, sendApiError } = host;
  const router = engine.createRouter();

  router.get('/status', async (req: Request, res: Response) => {
    try {
      const ctx = ApiContext.from(req, engine as never);
      await ctx.requirePermission('condo-manage');
      const units = engine.getManager<CondoUnitManager>('CondoUnitManager');
      res.json({ ok: true, units: units?.count() ?? 0 });
    } catch (err) {
      if (err instanceof ApiError) { sendApiError(res, err); return; }
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  return router;
}
