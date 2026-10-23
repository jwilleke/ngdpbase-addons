/**
 * Accommodation API — mounted at /api/accommodation by index.ts.
 *
 * Every restricted route asks its permission on the request's own ApiContext;
 * a refusal goes out through sendApiError. No role name, no session read.
 * Core values come from the `host` ngdpbase hands register() (#1813); only
 * types are imported from core.
 */
import type { Request, Response, Router } from 'express';
import type { AddonHost } from '@jwilleke/ngdpbase-types';
import type AccommodationManager from '../managers/AccommodationManager.js';

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
      await ctx.requirePermission('accommodation-read');
      const accommodations = engine.getManager<AccommodationManager>('AccommodationManager');
      res.json({ ok: true, accommodations: accommodations?.count() ?? 0 });
    } catch (err) {
      if (err instanceof ApiError) { sendApiError(res, err); return; }
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  return router;
}
