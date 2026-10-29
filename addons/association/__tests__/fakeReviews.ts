/**
 * A stand-in for core's review door (host.reviews, ngdpbase#2072), as ReviewManager behaves:
 * filing keeps the request open; listing, reading and deciding ask the decider's permission;
 * rejecting runs no add-on code; approving runs the registered handler with the decider's
 * context, and a handler that throws leaves the request open with its reason. Nothing is
 * written to disk.
 */
import type { ActorContext, ReviewHandler, ReviewRequest, ReviewRequestInput } from '@jwilleke/ngdpbase-types';

export interface FakeReviews {
  requests: Map<string, ReviewRequest>;
  /** Who each request was filed as, in order. */
  filedAs: string[];
  /** When set, filing throws as core does on a site that cannot keep requests. */
  unavailable: boolean;
  handle(handler: ReviewHandler): void;
  fileRequest(ctx: ActorContext, input: ReviewRequestInput): Promise<ReviewRequest>;
  listOpen(ctx: ActorContext): Promise<ReviewRequest[]>;
  get(ctx: ActorContext, id: string): Promise<ReviewRequest | null>;
  decide(ctx: ActorContext, id: string, decision: 'approve' | 'reject', note?: string): Promise<ReviewRequest>;
}

const named = (name: string, message: string, extra: Record<string, unknown> = {}): Error => Object.assign(new Error(message), { name, ...extra });

/** `mayDecide` is the PDP's answer for the request's permission, asked with the caller's context. */
export function fakeReviews(mayDecide: (ctx: ActorContext) => boolean): FakeReviews {
  let handler: ReviewHandler | null = null;
  let n = 0;
  const refuse = (ctx: ActorContext, permission: string): void => {
    if (!mayDecide(ctx)) throw named('ReviewRefusedError', `Refused: '${permission}' is required to decide this request`, { permission, decision: { permit: false, applicable: true, reason: 'policy_deny' } });
  };
  const door: FakeReviews = {
    requests: new Map(),
    filedAs: [],
    unavailable: false,
    handle(h) { handler = h; },
    async fileRequest(ctx, input) {
      if (door.unavailable) throw named('ReviewsUnavailableError', 'Requests for review are kept in the application database, which is not open on this site.');
      const id = `${(++n).toString(16).padStart(8, 'a')}-0000-4000-8000-000000000000`;
      const request: ReviewRequest = {
        id, kind: input.kind, subject: input.subject, summary: input.summary, details: input.details ?? {}, decidePermission: input.decidePermission,
        handlerId: input.handlerId, status: 'open', filedAt: '2026-10-29T12:00:00.000Z', filedBy: (ctx as { username?: string }).username ?? 'anonymous',
        decidedAt: null, decidedBy: null, note: null, outcome: null, failedAt: null, failure: null
      };
      door.requests.set(id, request);
      door.filedAs.push(request.filedBy);
      return request;
    },
    async listOpen(ctx) {
      return [...door.requests.values()].filter(r => r.status === 'open' && mayDecide(ctx));
    },
    async get(ctx, id) {
      const r = door.requests.get(id);
      if (!r) return null;
      refuse(ctx, r.decidePermission);
      return r;
    },
    async decide(ctx, id, decision) {
      const r = door.requests.get(id);
      if (!r) throw named('ReviewNotOpenError', 'There is no such request');
      refuse(ctx, r.decidePermission);
      if (r.status !== 'open') throw named('ReviewNotOpenError', `This request was ${r.status} already`);
      const by = (ctx as { username?: string }).username ?? null;
      if (decision === 'reject') {
        Object.assign(r, { status: 'rejected', decidedBy: by });
        return r;
      }
      try {
        if (!handler) throw new Error('The add-on that carries out this request is not running on this site');
        const result = await handler(r, ctx);
        Object.assign(r, { status: 'approved', decidedBy: by, outcome: result.summary, failedAt: null, failure: null });
        return r;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        Object.assign(r, { failedAt: '2026-10-29T12:00:00.000Z', failure: reason });
        throw named('ReviewHandlerFailedError', `The request was not carried out: ${reason}`, { reason });
      }
    }
  };
  return door;
}
