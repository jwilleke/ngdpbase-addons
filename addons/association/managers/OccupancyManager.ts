/**
 * OccupancyManager — the Occupancy information form's submissions (ORC 5311.09; #32).
 * Registered on the engine as 'OccupancyManager'.
 *
 * Every submission waits for review (17a): the handler checks the answers, records
 * `occupancy-submit` before it keeps anything (on-failure refuse), keeps the submission in
 * the add-on's encrypted database, and files it with core's reviews (ngdpbase#2112) as an
 * `association.occupancy` request decided by the holders of `association-review`. Core tells
 * them, lists it on /reviews and the Executive Hub, and records each decision. Nothing is
 * applied to an account or an accommodation here.
 *
 * Approval (applyReview, core's handler for the request) applies the submission as the system,
 * with a reason naming the request and the decider, the way accommodation's owner-change
 * requests are applied: the decider needs `association-review` and nothing that writes. It adds
 * the ownership or occupies entry (accommodation's changeLink), writes the details to the
 * account's identity record (IdentityManager), in schema.org shape, by accommodation's own
 * mapping (ResidencyManager.contactDetails), and makes and invites an account when none has the
 * email. A rejection changes nothing. Association's own review page decides through the same
 * request (`decide`), so the outcome is the same on every page.
 *
 * The entry's dates and unit are checked by accommodation's own rule
 * (ResidencyManager.checkEntry), the one that applies them later, never a copy of it.
 */
import type { ActorContext, AddonHost, AddonReviews, ContactPointEntry, Decision, PostalAddress, ReviewRequest } from '@jwilleke/ngdpbase-types';
import { occupancyForm } from '../forms/occupancyForm.js';

/** The kind and handler of an occupancy form's review request (ngdpbase#2112). */
export const OCCUPANCY_REVIEW = 'association.occupancy';

/** The share an owner's entry is given on approval; stated in the request, so the decider sees it. */
const OWNER_SHARE = 100;

/** core's review door, as far as this manager uses it (host.reviews). */
export type OccupancyReviews = Pick<AddonReviews, 'fileRequest' | 'listOpen' | 'get' | 'decide'>;

/** accommodation's mapping from the form's answers to identity-record fields (ResidencyManager.contactDetails). */
export type ContactDetailsFrom = (answers: Record<string, unknown>) => { address?: PostalAddress; contactPoint: ContactPointEntry[] };

/** A "no" from the decision point, carrying the permission and decision for ApiContext.enforceDeny. */
export class OccupancyRefusedError extends Error {
  override readonly name = 'OccupancyRefusedError';
  constructor(readonly permission: string, readonly decision: Decision) {
    super(`refused: ${permission}`);
  }
}

/** A review refused for a reason the reviewer can act on: not found, already decided, or not appliable. */
export class OccupancyReviewError extends Error {
  override readonly name = 'OccupancyReviewError';
}

/** The entry approve asks accommodation to add, and where it landed (to remove it again). */
export interface EntryRef { type: 'owner' | 'occupant'; index: number; expected: string }
export interface NewEntry { parcel: string; type: 'owner' | 'occupant'; from: string; to: string; share?: number }

/** The doors approval goes through, each under the system context it is given (ngdpbase#2112). */
export interface ApprovalDoors {
  /** UserManager.searchUsers(email, { limit: 2, activeOnly: false }, ctx). */
  searchUsers: (ctx: ActorContext, email: string) => Promise<Array<{ username: string; email?: string }>>;
  /** Whether an account already has this username, ignoring case (UserManager.searchUsers, every match). */
  usernameTaken: (ctx: ActorContext, username: string) => Promise<boolean>;
  /** ResidencyManager.changeLink: add, and remove for the undo. */
  addEntry: (ctx: ActorContext, username: string, entry: NewEntry) => Promise<EntryRef | undefined>;
  removeEntry: (ctx: ActorContext, username: string, at: EntryRef) => Promise<void>;
  /** IdentityManager.getByUserIdentifier and update: the person's own identity record. */
  findPerson: (ctx: ActorContext, username: string) => Promise<{ id: string; contactPoint?: unknown[] } | null>;
  updatePerson: (ctx: ActorContext, id: string, patch: Record<string, unknown>) => Promise<unknown>;
  /** accommodation's ResidencyManager.contactDetails: the one mapping of the answers to identity-record fields. */
  contactDetails: ContactDetailsFrom;
  /** UserManager.createUser with no password (#34). */
  createUser: (ctx: ActorContext, user: { username: string; email: string; displayName: string }) => Promise<{ username: string }>;
  /** AuthManager.inviteUser: 'sent', or why nothing was sent. */
  inviteUser: (ctx: ActorContext, username: string) => Promise<{ outcome: string; reason?: string }>;
}

/** What approval did: the account, and for a new one whether its invitation went out. */
export interface ApprovalResult { username: string; created: boolean; invitation?: { outcome: string; reason?: string } }

/**
 * The identity store's side of "a reference stores the @id" (#2042): IdentityManager.identityIdOf
 * (null for no account, and for a store that cannot answer) and, for the start-up conversion,
 * canAnswer and convertReference (which throws when the store cannot answer).
 */
export interface IdentityDoors {
  identityIdOf: (ctx: ActorContext, username: string) => Promise<string | null>;
  canAnswer: () => boolean;
  convertReference: (ctx: ActorContext, stored: string) => Promise<{ value: string; outcome: 'kept' | 'orphan' | 'converted' | 'orphaned' }>;
}

/** What the start-up conversion did, counts only (never a name). */
export interface SubmitterConversion { converted: number; orphans: number; postponed: boolean }

/** A submission as the review page shows it. */
export interface PendingSubmission {
  id: string;
  receivedAt: string;
  /** The submitter's identity @id; `anonymous`, `orphan:<name>`, or a name with no account, as stored. */
  submittedBy: string;
  /** Their name, for showing. */
  submitterName: string;
  unit: string;
  entryType: 'owner' | 'occupant';
  answers: Record<string, unknown>;
  /** How many accounts have its email: approval needs exactly one, or none (a new one is made). */
  accounts?: 'none' | 'one' | 'several';
  /** The share an owner's entry is given on approval. */
  share?: number;
}

/** The slice of the SQLite handle this manager uses. */
export interface OccupancyDb {
  prepare(sql: string): { run(...params: unknown[]): { changes: number } | unknown; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
}

/** A submission as the forms add-on hands it to the handler. */
export interface OccupancySubmission {
  id: string;
  /** The submitter's identity @id (core's forms add-on, 5.34.0 on); `anonymous` or a bare username is also accepted. */
  submittedBy: string;
  /** The submitter's name as shown; absent, the name is `submittedBy`. */
  submitterName?: string;
  formVersion?: string;
  data: Record<string, unknown>;
}

/** What the handler answers the forms add-on: accepted, or refused with a message per field. */
export type OccupancyResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

/** What the manager hands to the audit door; index.ts wraps ngdpbase's recordAuditEvent. */
export interface OccupancyAuditRecord {
  eventType: ReturnType<AddonHost['addonAuditEventName']>;
  user: string;
  actor?: string;
  ipAddress: string | undefined;
  result: 'success' | 'failure';
  action: string;
  severity: 'low' | 'medium' | 'high';
  resource: string;
  resourceType: 'accommodation';
  metadata: Record<string, unknown>;
}

export interface OccupancyManagerOptions {
  db: OccupancyDb;
  /** The doors approval goes through; absent, approval is refused. */
  approval?: ApprovalDoors;
  /** core's reviews (host.reviews): every submission is filed and decided there (ngdpbase#2112). */
  reviews?: OccupancyReviews;
  /** ngdpbase's decision point, with the caller's context as given. */
  decide: (ctx: ActorContext, request: { action: string }) => Promise<Decision>;
  /** ngdpbase's recordAuditEvent for this add-on; throws when a refuse event cannot be written. */
  recordAudit: (record: OccupancyAuditRecord) => Promise<void>;
  host: Pick<AddonHost, 'actorOf' | 'addonAuditEventName'>;
  /** accommodation's ResidencyManager.checkEntry: why the entry would be refused, or null. */
  checkEntry: (entry: { parcel: string; type: 'owner' | 'occupant'; from: string; to: string }) => string | null;
  /** The identity store (#2042): absent, a reference is kept as given. */
  identities?: IdentityDoors;
  /** host.systemContext: the system principal, with the reason it acts (the identity lookups, filing, an approval). */
  systemContext?: (reason: string) => ActorContext;
  now?: () => Date;
}


/** A username UserManager accepts. */
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

/** What an approval did, in a line for the decider: core keeps it as the request's outcome. */
function summaryOf(result: ApprovalResult, entry: NewEntry, unit: string): string {
  const what = `${entry.type === 'owner' ? `Owner (${entry.share}%)` : 'Occupant'} of unit ${unit} from ${entry.from}`;
  if (!result.created) return `${what}: added for ${result.username}, and the details saved.`;
  if (result.invitation?.outcome === 'sent') return `${what}: added for ${result.username}, a new account, invited by email; the details saved.`;
  return `${what}: added for ${result.username}, a new account; the invitation was not sent (${result.invitation?.reason ?? result.invitation?.outcome ?? 'unknown'}): resend it from User Management.`;
}

/** A form answer as a trimmed string; anything else is empty. */
function answer(data: Record<string, unknown>, name: string): string {
  const value = data[name];
  return typeof value === 'string' ? value.trim() : '';
}

export default class OccupancyManager {
  private readonly options: OccupancyManagerOptions;
  private readonly now: () => Date;

  constructor(options: OccupancyManagerOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Keep one owner's submission for review, as the person who sent it (`ctx`, anonymous or not),
   * and file it with core's reviews in their name (ngdpbase#2112). Refused, with nothing kept: no
   * answer to whether they are already an owner, no email, or an entry accommodation would refuse
   * (an unknown unit, a bad date, a last date before the first). A blank last date is "current".
   * A request that cannot be filed keeps nothing either: the row is removed again and the failure
   * recorded; when core cannot keep requests on this site, the sender is told so.
   */
  async queue(ctx: ActorContext, submission: OccupancySubmission): Promise<OccupancyResult> {
    const { data } = submission;
    // Owners only (operator, 2026-10-25): occupants are added by a signed-in owner, not through this form.
    const type = 'owner' as const;
    if (!['Yes', 'No'].includes(answer(data, 'existingOwner'))) return { ok: false, error: 'Please correct the marked fields', fields: { existingOwner: 'Choose Yes or No' } };
    if (!answer(data, 'email')) return { ok: false, error: 'Please correct the marked fields', fields: { email: 'An email is required' } };
    const unit = answer(data, 'unit');
    const entry = { parcel: unit, type, from: answer(data, 'from'), to: answer(data, 'to') || 'current' };
    const problem = this.options.checkEntry(entry);
    if (problem) return { ok: false, error: `Not accepted: ${problem}` };
    if (!this.options.reviews) throw new Error('OccupancyManager was started without core\'s reviews');

    const answered = Object.keys(data).filter(k => answer(data, k) !== '').sort();
    // Who sent it, by identity @id (#2042): kept as given when it already is one, or has no account.
    const submitterName = submission.submitterName?.trim() || submission.submittedBy;
    const submittedBy = await this.referenceOf(submission.submittedBy);
    const { metadata: whoMetadata, ...who } = this.options.host.actorOf(ctx);
    const record = (result: 'success' | 'failure', reason?: string): OccupancyAuditRecord => ({
      eventType: this.options.host.addonAuditEventName('occupancy-submit'),
      ...who,
      result,
      action: `occupancy-submit-${type}`, severity: 'low', resource: unit, resourceType: 'accommodation',
      // The names of the questions answered, never the answers.
      metadata: { ...whoMetadata, submissionId: submission.id, entryType: type, fields: answered, ...(reason ? { reason } : {}) }
    });
    // on-failure refuse: no record, nothing kept.
    await this.options.recordAudit(record('success'));
    try {
      this.options.db.prepare(`INSERT INTO association_occupancy_submissions
        (id, received_at, submitted_by, submitter_name, form_version, unit, entry_type, answers) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(submission.id, this.now().toISOString(), submittedBy, submitterName, submission.formVersion ?? '', unit, type, JSON.stringify(data));
    } catch (err) {
      await this.options.recordAudit(record('failure', err instanceof Error ? err.message : String(err))).catch(() => undefined);
      throw err;
    }
    try {
      await this.file(ctx, submission.id);
    } catch (err) {
      this.options.db.prepare(`DELETE FROM association_occupancy_submissions WHERE id = ?`).run(submission.id);
      await this.options.recordAudit(record('failure', `not filed for review: ${err instanceof Error ? err.name : 'error'}`)).catch(() => undefined);
      if ((err as Error)?.name === 'ReviewsUnavailableError') {
        return { ok: false, error: 'The association cannot take submissions for review on this site right now; nothing was kept. Please try again later.' };
      }
      throw err;
    }
    return { ok: true };
  }

  /**
   * File one kept submission with core's reviews, as `ctx` (its sender, or the system for one kept
   * before reviews), and store the request's id on it. Core tells the holders of
   * `association-review`. The request carries the answers, labelled as the form asks them, and
   * what approval will do, so a decider on /reviews or the Executive Hub sees what they approve.
   */
  private async file(ctx: ActorContext, id: string): Promise<string> {
    const reviews = this.reviews();
    const row = this.options.db.prepare(`SELECT unit, entry_type, answers FROM association_occupancy_submissions WHERE id = ?`).get(id) as
      { unit: string; entry_type: 'owner' | 'occupant'; answers: string } | undefined;
    if (!row) throw new OccupancyReviewError(`no submission ${id}`);
    const data = JSON.parse(row.answers) as Record<string, unknown>;
    const name = [answer(data, 'firstName'), answer(data, 'lastName')].filter(Boolean).join(' ') || answer(data, 'email');
    const to = answer(data, 'to');
    const details: Record<string, string | number> = { Unit: row.unit, Entry: row.entry_type };
    let section = '';
    for (const field of occupancyForm.fields) {
      if (field.type === 'section') { section = field.label; continue; }
      const value = answer(data, field.name);
      if (!value) continue;
      // A label asked twice (Email, Phone) is told apart by its section.
      const label = details[field.label] === undefined ? field.label : `${section}: ${field.label}`;
      details[label] = value;
    }
    if (row.entry_type === 'owner') details['Share on approval'] = `${OWNER_SHARE}% (a different split is set on the unit's page afterwards)`;
    details['On approval'] = 'Adds the entry for the account with this email and saves these details to its identity record; '
      + 'with no such account, one is made with a username from the name and its owner is invited by email. Applied by the system, naming you.';
    const filed = await reviews.fileRequest(ctx, {
      kind: OCCUPANCY_REVIEW, handlerId: OCCUPANCY_REVIEW, decidePermission: 'association-review',
      subject: `Occupancy information, unit ${row.unit}`,
      summary: `${name}, ${row.entry_type} of unit ${row.unit} from ${answer(data, 'from')}${to ? ` to ${to}` : ''}`,
      details
    });
    this.options.db.prepare(`UPDATE association_occupancy_submissions SET review_id = ? WHERE id = ?`).run(filed.id, id);
    return filed.id;
  }

  /**
   * File every pending submission kept before reviews (ngdpbase#2112), once, under the system
   * context: at start-up, and again before the review page lists. Counts only. When core cannot
   * keep requests, the rest wait for the next try.
   */
  async fileWaiting(): Promise<{ filed: number; postponed: boolean }> {
    if (!this.options.reviews) return { filed: 0, postponed: false };
    const rows = this.options.db.prepare(`SELECT id FROM association_occupancy_submissions WHERE status = 'pending' AND review_id IS NULL ORDER BY received_at, id`).all() as Array<{ id: string }>;
    let filed = 0;
    for (const r of rows) {
      try {
        await this.file(this.system(`association: file occupancy form ${r.id}, kept before core's reviews, for review (ngdpbase#2112)`), r.id);
        filed++;
      } catch {
        return { filed, postponed: true };
      }
    }
    return { filed, postponed: false };
  }

  /**
   * Every submission waiting for review, oldest first: those whose request is open for `ctx`.
   * Needs association-review. A submission whose request was rejected elsewhere (/reviews, the
   * Executive Hub) is marked rejected here as it is found; one approved elsewhere was marked by
   * its approval.
   */
  async pending(ctx: ActorContext): Promise<PendingSubmission[]> {
    await this.authorize(ctx);
    await this.fileWaiting();
    const open = new Set((await this.reviews().listOpen(ctx)).filter(r => r.kind === OCCUPANCY_REVIEW).map(r => r.id));
    const rows = this.options.db.prepare(`SELECT id, received_at, submitted_by, submitter_name, unit, entry_type, answers, review_id
      FROM association_occupancy_submissions WHERE status = 'pending' AND review_id IS NOT NULL ORDER BY received_at, id`).all() as Array<Record<string, string>>;
    const doors = this.options.approval;
    const list: PendingSubmission[] = [];
    for (const r of rows) {
      if (!open.has(r.review_id)) {
        await this.followDecision(ctx, r.id, r.review_id);
        continue;
      }
      const answers = JSON.parse(r.answers) as Record<string, unknown>;
      const found = doors ? await this.accountsFor(ctx, answer(answers, 'email')) : [];
      list.push({
        id: r.id, receivedAt: r.received_at, submittedBy: r.submitted_by, submitterName: r.submitter_name || r.submitted_by, unit: r.unit,
        entryType: r.entry_type as 'owner' | 'occupant', answers,
        ...(r.entry_type === 'owner' ? { share: OWNER_SHARE } : {}),
        ...(doors ? { accounts: found.length === 0 ? 'none' as const : found.length === 1 ? 'one' as const : 'several' as const } : {})
      });
    }
    return list;
  }

  /** A pending submission whose request is not open for `ctx`: marked rejected when core says it was. */
  private async followDecision(ctx: ActorContext, id: string, reviewId: string): Promise<void> {
    try {
      const request = await this.reviews().get(ctx, reviewId);
      if (request?.status === 'rejected') this.markRejected(id);
    } catch {
      // Not this viewer's to see, or reviews are off: left as it is.
    }
  }

  private markRejected(id: string): void {
    this.options.db.prepare(`UPDATE association_occupancy_submissions SET status = 'rejected' WHERE id = ? AND status = 'pending'`).run(id);
  }

  /**
   * Decide one pending submission from association's own review page, through its core request
   * (ngdpbase#2112), so the outcome is the one /reviews and the Executive Hub give: core asks
   * `association-review` of `ctx` and records the decision, and an approval runs applyReview.
   * A submission kept before reviews is filed first. A rejection changes nothing but the
   * submission's status. Returns core's outcome (what approval did) for the page.
   */
  async decide(ctx: ActorContext, id: string, decision: 'approve' | 'reject'): Promise<{ outcome: string }> {
    await this.authorize(ctx);
    const row = this.options.db.prepare(`SELECT status, review_id FROM association_occupancy_submissions WHERE id = ?`).get(id) as
      { status: string; review_id: string | null } | undefined;
    if (!row) throw new OccupancyReviewError(`no submission ${id}`);
    if (row.status !== 'pending') throw new OccupancyReviewError(`submission ${id} was already ${row.status}`);
    const reviewId = row.review_id ?? await this.file(this.system(`association: file occupancy form ${id}, kept before core's reviews, for review (ngdpbase#2112)`), id);
    const decided = await this.reviews().decide(ctx, reviewId, decision);
    if (decision === 'reject') {
      this.markRejected(id);
      return { outcome: 'rejected' };
    }
    return { outcome: decided.outcome ?? 'approved' };
  }

  /**
   * What became of a submission's request, for association's review page after a decision: core's
   * outcome, or why an approval was not carried out. Needs association-review, and core asks the
   * request's own permission of `ctx`. Null when there is no such submission or request.
   */
  async decisionOf(ctx: ActorContext, id: string): Promise<{ outcome: string | null; failure: string | null } | null> {
    await this.authorize(ctx);
    const row = this.options.db.prepare(`SELECT review_id FROM association_occupancy_submissions WHERE id = ?`).get(id) as { review_id: string | null } | undefined;
    if (!row?.review_id) return null;
    const request = await this.reviews().get(ctx, row.review_id);
    return request ? { outcome: request.outcome, failure: request.failure } : null;
  }

  /**
   * Carry out an approved occupancy request (core's handler for `association.occupancy`,
   * ngdpbase#2112). Core has checked that the decider (`ctx`) holds `association-review`, and it
   * is asked again here; that is the only permission approving needs (operator, 2026-10-29: the
   * board decides, the system applies). So every write is made under the system context, with a
   * reason naming the submission, the request and the decider, as accommodation's owner-change
   * requests are applied: the audit shows who approved and that the system carried it out.
   *
   * Checked first, with nothing written: the submission is still pending, at most one account has
   * its email (more than one is never guessed), and accommodation accepts the entry. An owner's
   * share is {@link OWNER_SHARE}, as the request says. With no account, one is made with a username
   * from the name (`first.last`; with a short suffix from the request's id when that is taken).
   * Then: recorded as occupancy-approve (on-failure refuse), the account made and invited if
   * needed, the entry added through accommodation, the details written to the identity record, the
   * submission marked approved. If the details cannot be written, the entry is removed again; if
   * that fails too, the error says the entry is still there. Throws, leaving the request open with
   * the reason for the decider, whenever it is not done.
   */
  async applyReview(ctx: ActorContext, request: Pick<ReviewRequest, 'id'>): Promise<{ summary: string }> {
    await this.authorize(ctx);
    const doors = this.options.approval;
    if (!doors) throw new OccupancyReviewError('approving is not available on this site (no user or contact manager)');
    const row = this.options.db.prepare(`SELECT id, unit, entry_type, status, answers FROM association_occupancy_submissions WHERE review_id = ?`).get(request.id) as
      { id: string; unit: string; entry_type: 'owner' | 'occupant'; status: string; answers: string } | undefined;
    if (!row) throw new OccupancyReviewError('No occupancy form is kept for this request any more; reject it, and the owner can send the form again.');
    if (row.status !== 'pending') throw new OccupancyReviewError(`This occupancy form was already ${row.status}.`);
    const id = row.id;
    const system = this.system(`association: occupancy form ${id} (review ${request.id}) approved by ${ctx.username ?? 'unknown'}`);
    const data = JSON.parse(row.answers) as Record<string, unknown>;

    const email = answer(data, 'email');
    const matches = await this.accountsFor(system, email);
    if (matches.length > 1) throw new OccupancyReviewError(`more than one account has the email ${email}; not guessing which. Fix that on User Management, then approve again.`);
    // No account: a new one, made with no password and an invitation (#34).
    const username = matches.length === 1 ? matches[0].username : await this.newUsername(system, data, request.id);

    const entry: NewEntry = { parcel: row.unit, type: row.entry_type, from: answer(data, 'from'), to: answer(data, 'to') || 'current' };
    if (entry.type === 'owner') entry.share = OWNER_SHARE;
    const problem = this.options.checkEntry(entry);
    if (problem) throw new OccupancyReviewError(problem);
    const existing = matches.length === 1 ? await doors.findPerson(system, username) : null;
    if (matches.length === 1 && !existing) throw new OccupancyReviewError(`${username} has no identity record to hold the details`);

    // The owner by identity @id, their username beside it (#2042). A new account has no @id yet,
    // so its rows carry the name; a lookup that cannot answer is null, never a failed approval.
    const ownerId = existing?.id ?? await this.options.identities?.identityIdOf(system, username) ?? null;
    const { metadata: whoMetadata, ...who } = this.options.host.actorOf(system);
    const record = (result: 'success' | 'failure', reason?: string): OccupancyAuditRecord => ({
      eventType: this.options.host.addonAuditEventName('association-review'),
      ...who,
      result,
      action: 'occupancy-approve', severity: 'medium', resource: row.unit, resourceType: 'accommodation',
      metadata: { ...whoMetadata, submissionId: id, reviewId: request.id, decidedBy: ctx.username ?? 'unknown', entryType: row.entry_type, owner: ownerId ?? username, ownerUser: username, newAccount: matches.length === 0, ...(reason ? { reason } : {}) }
    });
    // on-failure refuse: no record, no change.
    await this.options.recordAudit(record('success'));
    const failed = async (reason: string, err: unknown): Promise<never> => {
      await this.options.recordAudit(record('failure', reason)).catch(() => undefined);
      throw err;
    };

    // A new account first: made with no password, and its owner invited to choose their own (#34).
    // Core records both. If a later step fails, the account stays; approving again finds it.
    let invitation: ApprovalResult['invitation'];
    let person = existing;
    if (matches.length === 0) {
      try {
        const displayName = [answer(data, 'firstName'), answer(data, 'lastName')].filter(Boolean).join(' ');
        await doors.createUser(system, { username, email, displayName });
        invitation = await doors.inviteUser(system, username);
        person = await doors.findPerson(system, username);
        if (!person) throw new Error(`${username} has no identity record to hold the details`);
      } catch (err) {
        return failed(`the account ${username} was not made ready: ${err instanceof Error ? err.message : String(err)}`, err);
      }
    }
    const kept0 = person!;

    let at: EntryRef | undefined;
    try {
      at = await doors.addEntry(system, username, entry);
    } catch (err) {
      return failed(`the entry was not added: ${err instanceof Error ? err.message : String(err)}`, err);
    }

    const details = doors.contactDetails(data);
    const written = new Set(details.contactPoint.map(c => c.contactType ?? ''));
    const kept = (kept0.contactPoint ?? []).filter(c => !written.has(String((c as Record<string, unknown>)['contactType'])));
    try {
      await doors.updatePerson(system, kept0.id, { ...(details.address ? { address: details.address } : {}), contactPoint: [...kept, ...details.contactPoint] });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      try {
        if (at) await doors.removeEntry(system, username, at);
      } catch (undo) {
        const still = `the details were not written (${why}), and the ${entry.type} entry for ${username} on ${row.unit} could not be removed again (${undo instanceof Error ? undo.message : String(undo)}): it is still in effect`;
        return failed(still, new Error(still));
      }
      return failed(`the details were not written (${why}); the entry was removed again`, err);
    }

    try {
      const done = this.options.db.prepare(`UPDATE association_occupancy_submissions SET status = 'approved' WHERE id = ? AND status = 'pending'`).run(id) as { changes: number };
      if (done.changes !== 1) throw new Error(`submission ${id} changed while it was being approved`);
    } catch (err) {
      const still = `the entry and the details for ${username} are in effect, but submission ${id} could not be marked approved: ${err instanceof Error ? err.message : String(err)}`;
      return failed(still, new Error(still));
    }
    const result: ApprovalResult = { username, created: matches.length === 0, ...(invitation ? { invitation } : {}) };
    return { summary: summaryOf(result, entry, row.unit) };
  }

  /**
   * The username for a new account: `first.last` from the form, as the review page used to
   * offer, else the email's local part; with a short suffix from the request's id when an account
   * has it already. Neither free: throws, and the decider makes the account on User Management.
   */
  private async newUsername(ctx: ActorContext, data: Record<string, unknown>, requestId: string): Promise<string> {
    const clean = (text: string): string => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '').slice(0, 56);
    const fromName = clean([answer(data, 'firstName'), answer(data, 'lastName')].filter(Boolean).join('.'));
    const base = USERNAME.test(fromName) ? fromName : clean(answer(data, 'email').split('@')[0] ?? '');
    if (!USERNAME.test(base)) throw new OccupancyReviewError('no username can be made from the name or email; make the account on User Management with this email, then approve again');
    const doors = this.options.approval!;
    for (const candidate of [base, `${base}.${requestId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase()}`]) {
      if (USERNAME.test(candidate) && !(await doors.usernameTaken(ctx, candidate))) return candidate;
    }
    throw new OccupancyReviewError(`the username ${base} is taken; make the account on User Management with this email, then approve again`);
  }

  /**
   * What to store for a user a record refers to (#2042): their identity @id; `anonymous`, an @id
   * and an orphan as given; the username when there is no account or the store cannot answer.
   */
  private async referenceOf(stored: string): Promise<string> {
    const identities = this.options.identities;
    if (!identities || !stored || /^(urn:|orphan:)/.test(stored) || stored.toLowerCase() === 'anonymous') return stored;
    return (await identities.identityIdOf(this.system('association: identity @id for a submitter (#2042)'), stored)) ?? stored;
  }

  private system(reason: string): ActorContext {
    if (!this.options.systemContext) throw new Error('OccupancyManager: no system context');
    return this.options.systemContext(reason);
  }

  private reviews(): OccupancyReviews {
    if (!this.options.reviews) throw new Error('OccupancyManager was started without core\'s reviews');
    return this.options.reviews;
  }

  /**
   * Once, at start-up (#2042): every stored `submitted_by` that is still a username becomes
   * IdentityManager.convertReference's answer, the name kept in `submitter_name`: the identity's
   * @id, or `orphan:<name>` when the name has no account (nobody's from then on, so a later account
   * with that name never takes it over). @ids, orphans and `anonymous` are left alone, so a second
   * start writes nothing. When the identity store cannot answer, nothing is written and the pass is
   * postponed to the next start. Counts only; no name is logged.
   */
  async convertSubmitters(): Promise<SubmitterConversion> {
    const identities = this.options.identities;
    if (!identities) return { converted: 0, orphans: 0, postponed: false };
    if (!identities.canAnswer()) return { converted: 0, orphans: 0, postponed: true };
    const ctx = this.system('association: convert stored submitters to identity @ids (#2042)');
    const rows = this.options.db.prepare(`SELECT id, submitted_by, submitter_name FROM association_occupancy_submissions`).all() as Array<Record<string, string>>;
    let converted = 0, orphans = 0;
    try {
      for (const r of rows) {
        const { value, outcome } = await identities.convertReference(ctx, r.submitted_by);
        if (outcome === 'orphan' || outcome === 'orphaned') orphans++;
        if (value === r.submitted_by) continue;
        // One write per submission; the guard on submitted_by keeps a concurrent change.
        this.options.db.prepare(`UPDATE association_occupancy_submissions SET submitted_by = ?, submitter_name = ? WHERE id = ? AND submitted_by = ?`)
          .run(value, r.submitter_name || r.submitted_by, r.id, r.submitted_by);
        if (outcome === 'converted') converted++;
      }
    } catch {
      return { converted, orphans, postponed: true };
    }
    return { converted, orphans, postponed: false };
  }

  /** The accounts whose email is exactly this one, found with `ctx` (the viewer listing, or the system applying). */
  private async accountsFor(ctx: ActorContext, email: string): Promise<Array<{ username: string }>> {
    const doors = this.options.approval!;
    return (await doors.searchUsers(ctx, email)).filter(u => (u.email ?? '').trim().toLowerCase() === email.toLowerCase());
  }

  /** Ask the decision point for association-review with the caller's context; a "no" throws. */
  private async authorize(ctx: ActorContext): Promise<void> {
    const decision = await this.options.decide(ctx, { action: 'association-review' });
    if (!decision.permit) throw new OccupancyRefusedError('association-review', decision);
  }

  /**
   * How many submissions wait for review, for the viewer of the Executive Hub card (ngdpbase#2094):
   * the open occupancy requests core lists for them, and any kept before reviews and not filed yet.
   * Needs association-review, asked with the viewer's context; a "no" throws. A count only.
   */
  async waitingCount(ctx: ActorContext): Promise<number> {
    await this.authorize(ctx);
    const open = (await this.reviews().listOpen(ctx)).filter(r => r.kind === OCCUPANCY_REVIEW).length;
    const unfiled = this.options.db.prepare(`SELECT COUNT(*) AS n FROM association_occupancy_submissions WHERE status = 'pending' AND review_id IS NULL`).get() as { n: number };
    return open + unfiled.n;
  }

  /** How many submissions are kept as pending (a request rejected elsewhere is counted until the review page is next opened). */
  pendingCount(): number {
    const row = this.options.db.prepare(`SELECT COUNT(*) AS n FROM association_occupancy_submissions WHERE status = 'pending'`).get() as { n: number };
    return row.n;
  }
}
