/**
 * The Executive Hub card (ngdpbase#2094): its figures, read as the viewer, and the grants
 * accommodation's own policy gives core's `executive` role.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ActorContext, Decision } from '@jwilleke/ngdpbase-types';
import { executiveCardSummary, type ExecutiveCardDoors } from '../managers/executiveCard.js';
import { AccommodationRefusedError } from '../managers/AccommodationManager.js';
import { OWNERSHIP_REQUEST } from '../managers/ResidencyManager.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const board = { username: 'board.chair', roles: ['executive'], isAuthenticated: true } as unknown as ActorContext;

function doors(permit: boolean, asked: unknown[] = []): ExecutiveCardDoors {
  return {
    decide: async (ctx, request) => { asked.push(['decide', ctx, request.action]); return { permit } as Decision; },
    unitIds: () => ['66-00001.000', '66-00002.000', '66-00003.000'],
    withoutOwner: async (ctx, ids) => { asked.push(['withoutOwner', ctx]); return ids.slice(2); },
    withoutBilling: (ids) => ids.slice(1),
    openRequests: async (ctx) => { asked.push(['openRequests', ctx]); return [{ kind: OWNERSHIP_REQUEST }, { kind: 'accounting.write-off' }, { kind: OWNERSHIP_REQUEST }]; }
  };
}

describe('the Executive Hub card', () => {
  test('counts owner-change requests, units with no owner and units that cannot be invoiced, as the viewer', async () => {
    const asked: unknown[] = [];
    const summary = await executiveCardSummary(doors(true, asked))(board);
    expect(summary).toEqual({
      figures: [
        { label: 'Owner-change requests waiting', value: 2 },
        { label: 'Units with no current owner', value: 1 },
        { label: 'Units with no usable billing address', value: 2 }
      ],
      message: '3 unit(s)'
    });
    expect(asked).toEqual([['decide', board, 'accommodation-read'], ['openRequests', board], ['withoutOwner', board]]);
  });

  test('a viewer refused accommodation-read gets no figures: the summary throws', async () => {
    await expect(executiveCardSummary(doors(false))(board)).rejects.toBeInstanceOf(AccommodationRefusedError);
  });
});

describe('the executive role in accommodation\'s policy', () => {
  const policies = defaults['ngdpbase.access.policies'] as Array<{ id: string; subjects: Array<{ type: string; value: string }>; actions: string[] }>;
  const forExecutive = policies.filter(p => p.subjects.some(s => s.type === 'role' && s.value === 'executive'));

  test('reads everything accommodation keeps and decides owner-change requests, nothing more', () => {
    expect(forExecutive.map(p => p.id)).toEqual(['accommodation-executive-access']);
    expect(forExecutive[0].actions).toEqual(['accommodation-read', 'accommodation-billing-read', 'accommodation-ownership-review']);
  });

  test('is given no permission that changes anything', () => {
    const granted = forExecutive.flatMap(p => p.actions);
    for (const write of ['accommodation-manage', 'accommodation-notices', 'accommodation-self']) expect(granted).not.toContain(write);
  });

  test('every permission it is given is one accommodation declares', () => {
    const declared = Object.keys(defaults['ngdpbase.permissions.definitions'] as Record<string, unknown>);
    for (const action of forExecutive.flatMap(p => p.actions)) expect(declared).toContain(action);
  });
});
