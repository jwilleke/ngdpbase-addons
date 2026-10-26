/**
 * Accommodation admin pages — mounted at /addons/accommodation by index.ts.
 *
 *   GET  /residents                  every accommodation with its current owners and occupants
 *   GET  /residents/:parcel          one accommodation: every owner and occupant entry, past and present
 *   POST /residents/:parcel/change   add a person (making their account when they have none), correct or remove one entry (#28)
 *   GET  /mine                       a signed-in resident's own units (#36), under accommodation-self
 *   POST /residents/:parcel/ownership the ownership really changed: new owners and shares from a date, a new ownership period (#43)
 *   POST /residents/:parcel/billing the treasurer sets where the unit's invoices go (ngdpbase#2042)
 *   POST /mine/:parcel/ownership-request an owner asks the Board to change the owners or shares (#40)
 *   POST /mine/:parcel/billing       an owner sets where their unit's invoices go, as the treasurer can (ngdpbase#2042)
 *   POST /mine/:parcel/occupant-end  an owner ends an occupant's entry on their unit (#37)
 *   POST /mine/:parcel/occupant-details an owner changes an occupant's phones, work and emergency contact (#37)
 *   POST /mine/:parcel/occupant-add  an owner adds an occupant, with a new account and invitation when needed (#37)
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
import { LinkChangeRefusedError, type LinkChange, type LinkChangeResult } from '../managers/ResidencyManager.js';
import type { LinkType, UnitLink } from '../managers/unitLinks.js';
import { billingForForm, unitAddress } from '../managers/billing.js';
import { countyRecordOf, suggestedBilling } from '../managers/countyRecord.js';
import { OCCUPANT_EDITABLE_FIELDS } from '../managers/contactDetails.js';

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  createRouter(): Router;
  templateData?: (req: Request) => Promise<Record<string, unknown>>;
}

/** How a person knows a unit: its street address, then the parcel ("13 Fairway Dr (66-09960.017)"). */
function unitLabel(accommodations: AccommodationManager, id: string): string {
  const street = unitAddress(accommodations.get(id))?.streetAddress;
  return street ? `${street} (${id})` : id;
}

/** Two street addresses as people find them: by street, then house number ("2 Eagle Dr" before "10 Eagle Dr"). */
function byStreet(a: string, b: string): number {
  const [na, ...sa] = a.split(' ');
  const [nb, ...sb] = b.split(' ');
  return sa.join(' ').localeCompare(sb.join(' ')) || (Number(na) || 0) - (Number(nb) || 0);
}

/** A form value as a trimmed string; anything else is empty. */
function text(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The link a form describes. Nothing is guessed: the manager refuses what does not read as a link.
 * A correction may name a new type (`as`); the entry's own `type` says where it is now.
 */
function linkFrom(body: Record<string, unknown>, parcel: string): UnitLink {
  const type = (text(body, 'as') || text(body, 'type')) as LinkType;
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

/**
 * A typed name as an account: a username, or the one account with that display name. Undefined for
 * someone new; more than one account with the name is refused, asking for the username.
 */
function accountNamed(people: Array<{ username: string; name: string }>, person: string): string | undefined {
  const named = people.filter(p => p.name.toLowerCase() === person.toLowerCase());
  const username = people.find(p => p.username === person)?.username ?? (named.length === 1 ? named[0].username : undefined);
  if (named.length > 1 && !username) throw new LinkChangeRefusedError(`more than one account is named ${person}; type the username the list shows beside the name`);
  return username;
}

/**
 * The billing entries a form posts: rows of `address` (free text, several lines) and `share`. A row
 * with no address is dropped and a blank share left out; the manager checks the rest.
 */
function billingFrom(body: Record<string, unknown>): unknown[] {
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
  const shares = list(body['share']);
  return list(body['address']).flatMap((a, i) => {
    const address = typeof a === 'string' ? a.replace(/\r\n?/g, '\n').trim() : '';
    const share = typeof shares[i] === 'string' ? (shares[i] as string).trim() : '';
    return address === '' ? [] : [{ address, ...(share === '' ? {} : { share: Number(share) }) }];
  });
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
          // by street, then house number, as people find them
          units: units
            .map(u => ({ id: u.id, label: unitLabel(accommodations, u.id), address: unitAddress(u), ...(roster.get(u.id) ?? { owners: [], occupants: [] }) }))
            .sort((a, b) => byStreet(a.address?.streetAddress ?? a.id, b.address?.streetAddress ?? b.id) || a.id.localeCompare(b.id)),
          // A unit's problem names the unit by its address, linked to its page; others as written.
          problems: (await residency.linkProblems(actor)).map(p => {
            const unit = /^unit (\S+): (.*)$/.exec(p);
            return unit && accommodations.get(unit[1])
              ? { unit: unit[1], label: unitLabel(accommodations, unit[1]), street: unitAddress(accommodations.get(unit[1]))?.streetAddress ?? unit[1], text: unit[2] }
              : { text: p };
          }).sort((a, b) => (a.street && b.street ? byStreet(a.street, b.street) : a.street ? -1 : b.street ? 1 : 0)),
          unbilled: residency.withoutBilling(units.map(u => u.id))
        });
      } catch (err) {
        if (err instanceof ApiError) { sendApiError(res, err, 'page'); return; }
        res.status(500).send('Could not show the owners and occupants');
      }
    })();
  });

  /**
   * One accommodation's page. `draft` is an add the admin typed and was refused, shown again so
   * nothing has to be typed twice; it goes in the page, never in the URL.
   */
  async function renderUnit(req: Request, res: Response, ctx: ReturnType<typeof ApiContext.from>, parcel: string,
    shown: { flash: string; reason: string; draft?: Record<string, string> }): Promise<void> {
    const { accommodations, residency } = managers();
    const actor = ctx.getActor();
    const { entries, shareProblems } = await residency.unitEntries(actor, parcel);
    res.render('accommodation-resident-unit', {
      ...(await engine.templateData?.(req)),
      currentUser: req.userContext,
      parcel,
      label: unitLabel(accommodations, parcel),
      county: countyRecordOf(accommodations.get(parcel)),
      billing: billingForForm(accommodations.get(parcel), suggestedBilling(accommodations.get(parcel))),
      entries,
      shareProblems,
      people: await residency.people(actor),
      draft: shown.draft ?? {},
      flash: shown.flash,
      reason: shown.reason
    });
  }

  router.get('/residents/:parcel', (req: Request, res: Response) => {
    void (async () => {
      try {
        const ctx = ApiContext.from(req, engine as never);
        await ctx.requirePermission('accommodation-read');
        const parcel = String(req.params['parcel']);
        if (!managers().accommodations.get(parcel)) { res.status(404).send('No such accommodation'); return; }
        await renderUnit(req, res, ctx, parcel, {
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
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        await ctx.requirePermission('accommodation-manage');
        const change = changeFrom(body, parcel);
        if (typeof change === 'string') { res.redirect(`${back}?flash=refused&reason=${encodeURIComponent(change)}`); return; }
        // Every edit of an owner or a share says what it is (operator, 2026-10-26, #43): a correction
        // stays in the ownership period; a real change goes to "Ownership changed", already filled in.
        const touchesOwner = (change.op === 'add' || change.op === 'correct') && (change.link.type === 'owner' || text(body, 'type') === 'owner');
        if (touchesOwner && text(body, 'kind') !== 'correction') {
          if (text(body, 'kind') !== 'change') throw new LinkChangeRefusedError('say whether this is correcting a mistake or the ownership really changed');
          const date = change.op === 'add' || change.op === 'correct' ? change.link.from : '';
          await renderUnit(req, res, ctx, parcel, { flash: 'use-ownership', reason: '', draft: {
            ownership: 'open', on: date,
            ...(change.op === 'add' ? { newPerson: text(body, 'person'), newShare: text(body, 'share') } : { changeUser: text(body, 'username'), changeShare: text(body, 'share') })
          } });
          return;
        }
        // Add a person: the one Name box is an account picked from the list (its name, or its
        // username), else someone new, whose account is made in the same save.
        if (change.op === 'add') {
          const { residency } = managers();
          const person = text(body, 'person');
          const username = accountNamed(await residency.people(ctx.getActor()), person);
          if (username) {
            res.redirect(afterChange(parcel, await residency.changeLink(ctx.getActor(), username, change)));
          } else {
            const made = await residency.addNewPerson(ctx.getActor(), change.link, { name: person, email: text(body, 'email'), invite: text(body, 'invite') === 'yes' });
            res.redirect(`${back}?flash=${made.invitation ? 'saved-invited' : 'saved-new'}`);
          }
          return;
        }
        const result = await managers().residency.changeLink(ctx.getActor(), text(body, 'username'), change);
        res.redirect(afterChange(parcel, result));
      } catch (err) {
        try {
          if ((err as Error).name === 'AccommodationRefusedError') {
            const refused = err as { permission: string; decision: never };
            await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
          }
          if ((err as Error).name === 'LinkChangeRefusedError') {
            if (text(body, 'op') === 'add') {
              // Shown again with what was typed: nothing to type twice, and nothing personal in the URL.
              const draft = Object.fromEntries(['person', 'type', 'from', 'share', 'email', 'invite', 'kind'].map(k => [k, text(body, k)]));
              await renderUnit(req, res, ctx, parcel, { flash: 'refused', reason: (err as Error).message, draft });
              return;
            }
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

  router.post('/mine/:parcel/occupant-add', (req: Request, res: Response) => {
    void (async () => {
      const ctx = ApiContext.from(req, engine as never);
      try {
        await ctx.requirePermission('accommodation-self');
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await managers().residency.addOccupant(ctx.getActor(), String(req.params['parcel']), {
          email: text(body, 'email'), name: text(body, 'name'), username: text(body, 'username'), from: text(body, 'from'), to: text(body, 'to')
        });
        const said = !result.created ? `${result.username} added`
          : result.invitation?.outcome === 'sent' ? `${result.username} added, with a new account; an invitation was emailed`
            : `${result.username} added, with a new account; the invitation was not sent (${result.invitation?.reason ?? result.invitation?.outcome ?? 'unknown'}), so ask an administrator to resend it`;
        res.redirect(`/addons/accommodation/mine?flash=occupant-added&reason=${encodeURIComponent(said)}`);
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
          const why = answer instanceof Error ? answer.message : String(answer);
          host.logger.error(`[accommodation] An owner's occupant add failed: ${why}`);
          res.status(500).send(`The occupant was not added: ${why}`);
        }
      }
    })();
  });

  router.post('/mine/:parcel/occupant-details', (req: Request, res: Response) => {
    void (async () => {
      const ctx = ApiContext.from(req, engine as never);
      try {
        await ctx.requirePermission('accommodation-self');
        const body = (req.body ?? {}) as Record<string, unknown>;
        // Only the fields an owner may change are passed on; the manager refuses anything else.
        const answers = Object.fromEntries(OCCUPANT_EDITABLE_FIELDS.map(f => [f, text(body, f)]));
        await managers().residency.updateOccupantDetails(ctx.getActor(), String(req.params['parcel']), text(body, 'username'), answers);
        res.redirect('/addons/accommodation/mine?flash=occupant-details');
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
          host.logger.error(`[accommodation] An owner's change to an occupant's details failed: ${answer instanceof Error ? answer.message : String(answer)}`);
          res.status(500).send("The occupant's details were not saved");
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

  // The ownership really changed (#43): from a date, the unit's owners are the rows given, in a new
  // ownership period. A row is a current owner (by username) or a typed name, an account or someone
  // new; a row with no share is left out. Refused with the reason, everything typed shown again.
  router.post('/residents/:parcel/ownership', (req: Request, res: Response) => {
    void (async () => {
      const ctx = ApiContext.from(req, engine as never);
      const parcel = String(req.params['parcel']);
      const back = `/addons/accommodation/residents/${encodeURIComponent(parcel)}`;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const list = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(x => (typeof x === 'string' ? x.trim() : ''));
      try {
        await ctx.requirePermission('accommodation-manage');
        const { residency } = managers();
        const people = await residency.people(ctx.getActor());
        const names = list(body['owner']); const shares = list(body['ownerShare']); const emails = list(body['ownerEmail']);
        const owners = names.flatMap((name, i) => {
          if (!name || !shares[i]) return [];
          const username = accountNamed(people, name);
          return [username ? { username, share: Number(shares[i]) } : { name, email: emails[i] ?? '', share: Number(shares[i]) }];
        });
        await residency.changeOwnership(ctx.getActor(), parcel, text(body, 'on'), owners);
        res.redirect(`${back}?flash=ownership-changed`);
      } catch (err) {
        try {
          if ((err as Error).name === 'AccommodationRefusedError') {
            const refused = err as { permission: string; decision: never };
            await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
          }
          if ((err as Error).name === 'LinkChangeRefusedError') {
            await renderUnit(req, res, ctx, parcel, { flash: 'refused', reason: (err as Error).message, draft: {
              ownership: 'open', on: text(body, 'on'),
              rows: JSON.stringify(list(body['owner']).map((owner, i) => ({ owner, share: list(body['ownerShare'])[i] ?? '', email: list(body['ownerEmail'])[i] ?? '' })))
            } });
            return;
          }
          throw err;
        } catch (answer) {
          if (answer instanceof ApiError) { sendApiError(res, answer, 'page'); return; }
          host.logger.error(`[accommodation] A change of ownership of ${parcel} failed: ${answer instanceof Error ? answer.message : String(answer)}`);
          res.status(500).send('The change of ownership was not saved');
        }
      }
    })();
  });

  // An owner asks the Board to change the owners or shares (#40): filed with core's reviews,
  // nothing changes until the Board approves. Rows are names as the page shows them, a share, and
  // an email for someone new; a row with no share is left out.
  router.post('/mine/:parcel/ownership-request', (req: Request, res: Response) => {
    void (async () => {
      const ctx = ApiContext.from(req, engine as never);
      const parcel = String(req.params['parcel']);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const list = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(x => (typeof x === 'string' ? x.trim() : ''));
      try {
        await ctx.requirePermission('accommodation-self');
        const shares = list(body['ownerShare']); const emails = list(body['ownerEmail']);
        const owners = list(body['owner']).flatMap((name, i) => (name && shares[i] ? [{ name, email: emails[i] ?? '', share: Number(shares[i]) }] : []));
        await managers().residency.requestOwnershipChange(ctx.getActor(), parcel, text(body, 'on'), owners);
        res.redirect('/addons/accommodation/mine?flash=ownership-requested');
      } catch (err) {
        try {
          if ((err as Error).name === 'AccommodationRefusedError') {
            const refused = err as { permission: string; decision: never };
            await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
          }
          if ((err as Error).name === 'LinkChangeRefusedError' || (err as Error).name === 'ReviewsUnavailableError') {
            const reason = (err as Error).name === 'ReviewsUnavailableError' ? 'requests cannot be filed on this site yet; ask the association' : (err as Error).message;
            res.redirect(`/addons/accommodation/mine?flash=refused&reason=${encodeURIComponent(reason)}`);
            return;
          }
          throw err;
        } catch (answer) {
          if (answer instanceof ApiError) { sendApiError(res, answer, 'page'); return; }
          host.logger.error(`[accommodation] An owner's request to change the owners failed: ${answer instanceof Error ? answer.message : String(answer)}`);
          res.status(500).send('The request was not filed');
        }
      }
    })();
  });

  // Where the unit's invoices go (ngdpbase#2042): the treasurer from the unit's page, an owner from
  // their own; ResidencyManager.setBilling decides which, and refuses the same things for both.
  const billingRoute = (permission: 'accommodation-manage' | 'accommodation-self', back: (parcel: string) => string) =>
    (req: Request, res: Response) => {
      void (async () => {
        const ctx = ApiContext.from(req, engine as never);
        const parcel = String(req.params['parcel']);
        try {
          await ctx.requirePermission(permission);
          await managers().residency.setBilling(ctx.getActor(), parcel, billingFrom((req.body ?? {}) as Record<string, unknown>));
          res.redirect(`${back(parcel)}?flash=billing-saved`);
        } catch (err) {
          try {
            if ((err as Error).name === 'AccommodationRefusedError') {
              const refused = err as { permission: string; decision: never };
              await ctx.enforceDeny(refused.permission, refused.decision); // always throws the ApiError
            }
            if ((err as Error).name === 'LinkChangeRefusedError') {
              res.redirect(`${back(parcel)}?flash=refused&reason=${encodeURIComponent((err as Error).message)}`);
              return;
            }
            throw err;
          } catch (answer) {
            if (answer instanceof ApiError) { sendApiError(res, answer, 'page'); return; }
            host.logger.error(`[accommodation] A billing change to ${parcel} failed: ${answer instanceof Error ? answer.message : String(answer)}`);
            res.status(500).send('The billing was not saved');
          }
        }
      })();
    };
  router.post('/residents/:parcel/billing', billingRoute('accommodation-manage', parcel => `/addons/accommodation/residents/${encodeURIComponent(parcel)}`));
  router.post('/mine/:parcel/billing', billingRoute('accommodation-self', () => '/addons/accommodation/mine'));

  return router;
}
