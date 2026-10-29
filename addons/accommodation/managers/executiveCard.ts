/**
 * The Executive Hub card's figures (ngdpbase#2094): what the board sees of accommodation on
 * `/executive`, read as the viewer. Core shows the card only to a viewer it permits
 * `accommodation-read`; the summary asks again with the viewer's context, as the residents page
 * does, and throws on a "no", so the card says its figures could not be read.
 *
 * Runs on every visit to the hub, uncached: it reads the same in-memory figures the residents page
 * and the `/admin` card read, never a unit's files or anyone's identity record.
 */
import type { ActorContext, Decision } from '@jwilleke/ngdpbase-types';
import { AccommodationRefusedError } from './AccommodationManager.js';
import { OWNERSHIP_REQUEST } from './ResidencyManager.js';

export interface ExecutiveCardFigure { label: string; value: number | string }
export interface ExecutiveCardSummary { figures: ExecutiveCardFigure[]; message?: string }

export interface ExecutiveCardDoors {
  decide: (ctx: ActorContext, request: { action: string }) => Promise<Decision>;
  /** Every accommodation's id: AccommodationManager.list(). */
  unitIds: () => string[];
  /** ResidencyManager.withoutOwner, read as the viewer. */
  withoutOwner: (ctx: ActorContext, ids: string[]) => Promise<string[]>;
  /** ResidencyManager.withoutBilling. */
  withoutBilling: (ids: string[]) => string[];
  /** core's reviews (host.reviews.listOpen): the open requests the viewer may decide. */
  openRequests: (ctx: ActorContext) => Promise<Array<{ kind: string }>>;
}

/** The card's `summary(ctx)`: owner-change requests waiting, units with no current owner, units that cannot be invoiced. */
export function executiveCardSummary(doors: ExecutiveCardDoors): (ctx: ActorContext) => Promise<ExecutiveCardSummary> {
  return async (ctx) => {
    const decision = await doors.decide(ctx, { action: 'accommodation-read' });
    if (!decision.permit) throw new AccommodationRefusedError('accommodation-read', decision);
    const ids = doors.unitIds();
    // Only the requests the viewer may decide are listed, so a viewer who decides none sees 0.
    const waiting = (await doors.openRequests(ctx)).filter(r => r.kind === OWNERSHIP_REQUEST).length;
    return {
      figures: [
        { label: 'Owner-change requests waiting', value: waiting },
        { label: 'Units with no current owner', value: (await doors.withoutOwner(ctx, ids)).length },
        { label: 'Units with no usable billing address', value: doors.withoutBilling(ids).length }
      ],
      message: `${ids.length} unit(s)`
    };
  };
}
