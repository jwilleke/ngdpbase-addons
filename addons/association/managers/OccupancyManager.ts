/**
 * OccupancyManager — the Occupancy information form's submissions (ORC 5311.09; #32).
 * Registered on the engine as 'OccupancyManager'.
 *
 * Every submission waits for review (17a): the handler checks the answers, records
 * `occupancy-submit` before it keeps anything (on-failure refuse), keeps the submission in
 * the add-on's encrypted database as pending, and tells the holders of `association-review`.
 * Nothing is applied to an account or an accommodation here.
 *
 * Review (#33): `pending` lists what waits, `reject` refuses one and `approve` applies one for
 * a person who has an account: their ownership or occupies entry (accommodation's changeLink,
 * which asks `accommodation-manage` itself) and their details on their identity record
 * (IdentityManager, `identity-manage`), in schema.org shape, by accommodation's own mapping
 * (ResidencyManager.contactDetails): the home address as `address`, every other address and phone
 * as a `contactPoint` typed by `contactType`. Each asks the decision
 * point for `association-review` with the reviewer's context (this manager is the
 * enforcement point for its submissions) and a "no" throws OccupancyRefusedError for
 * ApiContext.enforceDeny. A rejection is recorded before it is made (on-failure refuse).
 *
 * The entry's dates and unit are checked by accommodation's own rule
 * (ResidencyManager.checkEntry), the one that applies them later, never a copy of it.
 */
import type { ActorContext, AddonHost, ContactPointEntry, Decision, PostalAddress } from '@jwilleke/ngdpbase-types';

/** accommodation's mapping from the form's answers to identity-record fields (ResidencyManager.contactDetails). */
export type ContactDetailsFrom = (answers: Record<string, unknown>) => { address?: PostalAddress; contactPoint: ContactPointEntry[] };

/** A "no" from the decision point, carrying the permission and decision for ApiContext.enforceDeny. */
export class OccupancyRefusedError extends Error {
  override readonly name = 'OccupancyRefusedError';
  constructor(readonly permission: string, readonly decision: Decision) {
    super(`refused: ${permission}`);
  }
}

/** A review refused for a reason the reviewer can act on: not found, or already decided. */
export class OccupancyReviewError extends Error {
  override readonly name = 'OccupancyReviewError';
}

/** The entry approve asks accommodation to add, and where it landed (to remove it again). */
export interface EntryRef { type: 'owner' | 'occupant'; index: number; expected: string }
export interface NewEntry { parcel: string; type: 'owner' | 'occupant'; from: string; to: string; share?: number }

/** The doors approve goes through, each with the reviewer's context. */
export interface ApprovalDoors {
  /** UserManager.searchUsers(email, { limit: 2, activeOnly: false }, ctx). */
  searchUsers: (ctx: ActorContext, email: string) => Promise<Array<{ username: string; email?: string }>>;
  /** ResidencyManager.changeLink: add, and remove for the undo. */
  addEntry: (ctx: ActorContext, username: string, entry: NewEntry) => Promise<EntryRef | undefined>;
  removeEntry: (ctx: ActorContext, username: string, at: EntryRef) => Promise<void>;
  /** IdentityManager.getByUserIdentifier and update: the person's own identity record. */
  findPerson: (ctx: ActorContext, username: string) => Promise<{ id: string; contactPoint?: unknown[] } | null>;
  updatePerson: (ctx: ActorContext, id: string, patch: Record<string, unknown>) => Promise<unknown>;
  /** accommodation's ResidencyManager.contactDetails: the one mapping of the answers to identity-record fields. */
  contactDetails: ContactDetailsFrom;
  /** UserManager.createUser with no password, as the reviewer (#34). */
  createUser: (ctx: ActorContext, user: { username: string; email: string; displayName: string }) => Promise<{ username: string }>;
  /** AuthManager.inviteUser, as the reviewer: 'sent', or why nothing was sent. */
  inviteUser: (ctx: ActorContext, username: string) => Promise<{ outcome: string; reason?: string }>;
}

/** What approve did: the account, and for a new one whether its invitation went out. */
export interface ApprovalResult { username: string; created: boolean; invitation?: { outcome: string; reason?: string } }

/** A submission as the review page shows it. */
export interface PendingSubmission {
  id: string;
  receivedAt: string;
  submittedBy: string;
  unit: string;
  entryType: 'owner' | 'occupant';
  answers: Record<string, unknown>;
  /** How many accounts have its email: approve needs exactly one, or none and a username for a new one. */
  accounts?: 'none' | 'one' | 'several';
}

/** The slice of the SQLite handle this manager uses. */
export interface OccupancyDb {
  prepare(sql: string): { run(...params: unknown[]): { changes: number } | unknown; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
}

/** A submission as the forms add-on hands it to the handler. */
export interface OccupancySubmission {
  id: string;
  submittedBy: string;
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
  /** The doors approve goes through; absent, approve is refused. */
  approval?: ApprovalDoors;
  /** ngdpbase's decision point, with the caller's context as given. */
  decide: (ctx: ActorContext, request: { action: string }) => Promise<Decision>;
  /** ngdpbase's recordAuditEvent for this add-on; throws when a refuse event cannot be written. */
  recordAudit: (record: OccupancyAuditRecord) => Promise<void>;
  host: Pick<AddonHost, 'actorOf' | 'addonAuditEventName'>;
  /** accommodation's ResidencyManager.checkEntry: why the entry would be refused, or null. */
  checkEntry: (entry: { parcel: string; type: 'owner' | 'occupant'; from: string; to: string }) => string | null;
  /** Tell the holders of association-review that a submission waits. Must not throw. */
  notifyReviewers: (title: string, message: string) => Promise<void>;
  now?: () => Date;
}

const ENTRY_TYPES: Record<string, 'owner' | 'occupant'> = { Owner: 'owner', Occupant: 'occupant' };

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
   * Keep one submission for review, as the person who sent it (`ctx`, anonymous or not).
   * Refused, with nothing kept: an entry type that is not Owner or Occupant, no email, or
   * an entry accommodation would refuse (an unknown unit, a bad date, a last date before the
   * first). A blank last date is "current".
   */
  async queue(ctx: ActorContext, submission: OccupancySubmission): Promise<OccupancyResult> {
    const { data } = submission;
    const type = ENTRY_TYPES[answer(data, 'entryType')];
    if (!type) return { ok: false, error: 'Please correct the marked fields', fields: { entryType: 'Choose Owner or Occupant' } };
    if (!answer(data, 'email')) return { ok: false, error: 'Please correct the marked fields', fields: { email: 'An email is required' } };
    const unit = answer(data, 'unit');
    const entry = { parcel: unit, type, from: answer(data, 'from'), to: answer(data, 'to') || 'current' };
    const problem = this.options.checkEntry(entry);
    if (problem) return { ok: false, error: `Not accepted: ${problem}` };

    const answered = Object.keys(data).filter(k => answer(data, k) !== '').sort();
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
        (id, received_at, submitted_by, form_version, unit, entry_type, answers) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(submission.id, this.now().toISOString(), submission.submittedBy, submission.formVersion ?? '', unit, type, JSON.stringify(data));
    } catch (err) {
      await this.options.recordAudit(record('failure', err instanceof Error ? err.message : String(err))).catch(() => undefined);
      throw err;
    }
    await this.options.notifyReviewers('Occupancy information waits for review',
      `A submission for unit ${unit} (${type}) waits for review.`);
    return { ok: true };
  }

  /** Every submission waiting for review, oldest first. Needs association-review. */
  async pending(ctx: ActorContext): Promise<PendingSubmission[]> {
    await this.authorize(ctx);
    const rows = this.options.db.prepare(`SELECT id, received_at, submitted_by, unit, entry_type, answers
      FROM association_occupancy_submissions WHERE status = 'pending' ORDER BY received_at, id`).all() as Array<Record<string, string>>;
    const doors = this.options.approval;
    const list: PendingSubmission[] = [];
    for (const r of rows) {
      const answers = JSON.parse(r.answers) as Record<string, unknown>;
      const found = doors ? await this.accountsFor(ctx, answer(answers, 'email')) : [];
      list.push({
        id: r.id, receivedAt: r.received_at, submittedBy: r.submitted_by, unit: r.unit,
        entryType: r.entry_type as 'owner' | 'occupant', answers,
        ...(doors ? { accounts: found.length === 0 ? 'none' as const : found.length === 1 ? 'one' as const : 'several' as const } : {})
      });
    }
    return list;
  }

  /**
   * Refuse one pending submission: nothing is applied, and it leaves the review list.
   * Needs association-review; recorded as occupancy-reject before it is made.
   */
  async reject(ctx: ActorContext, id: string): Promise<void> {
    await this.authorize(ctx);
    const row = this.options.db.prepare(`SELECT unit, entry_type, status FROM association_occupancy_submissions WHERE id = ?`).get(id) as
      { unit: string; entry_type: string; status: string } | undefined;
    if (!row) throw new OccupancyReviewError(`no submission ${id}`);
    if (row.status !== 'pending') throw new OccupancyReviewError(`submission ${id} was already ${row.status}`);
    const { metadata: whoMetadata, ...who } = this.options.host.actorOf(ctx);
    const record = (result: 'success' | 'failure', reason?: string): OccupancyAuditRecord => ({
      eventType: this.options.host.addonAuditEventName('association-review'),
      ...who,
      result,
      action: 'occupancy-reject', severity: 'low', resource: row.unit, resourceType: 'accommodation',
      metadata: { ...whoMetadata, submissionId: id, entryType: row.entry_type, ...(reason ? { reason } : {}) }
    });
    await this.options.recordAudit(record('success'));
    try {
      const done = this.options.db.prepare(`UPDATE association_occupancy_submissions SET status = 'rejected' WHERE id = ? AND status = 'pending'`).run(id) as { changes: number };
      if (done.changes !== 1) throw new Error(`submission ${id} changed while it was being rejected`);
    } catch (err) {
      await this.options.recordAudit(record('failure', err instanceof Error ? err.message : String(err))).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Apply one pending submission for the person with its email (#33), as the reviewer. Checked
   * first, with nothing written: exactly one account has the email (none, or more than one, is
   * never guessed), accommodation accepts the entry, and an owner's share is given. Then:
   * recorded as occupancy-approve (on-failure refuse), the entry added through accommodation,
   * the details written to the person's identity record, the submission marked approved. If the
   * details cannot be written, the entry is removed again and the submission stays pending; if
   * that fails too, the error says the entry is still there.
   */
  async approve(ctx: ActorContext, id: string, options: { share?: number; newUsername?: string } = {}): Promise<ApprovalResult> {
    await this.authorize(ctx);
    const doors = this.options.approval;
    if (!doors) throw new OccupancyReviewError('approving is not available on this site (no user or contact manager)');
    const row = this.options.db.prepare(`SELECT unit, entry_type, status, answers FROM association_occupancy_submissions WHERE id = ?`).get(id) as
      { unit: string; entry_type: 'owner' | 'occupant'; status: string; answers: string } | undefined;
    if (!row) throw new OccupancyReviewError(`no submission ${id}`);
    if (row.status !== 'pending') throw new OccupancyReviewError(`submission ${id} was already ${row.status}`);
    const data = JSON.parse(row.answers) as Record<string, unknown>;

    const email = answer(data, 'email');
    const matches = await this.accountsFor(ctx, email);
    if (matches.length > 1) throw new OccupancyReviewError(`more than one account has the email ${email}; not guessing which`);
    // No account: the reviewer names a new one, made with no password and an invitation (#34).
    const newUsername = matches.length === 0 ? (options.newUsername ?? '').trim() : '';
    if (matches.length === 0 && !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(newUsername)) {
      throw new OccupancyReviewError(`no account has the email ${email}; give a username for a new one (letters, digits, . _ -)`);
    }
    const username = matches.length === 1 ? matches[0].username : newUsername;

    const entry: NewEntry = { parcel: row.unit, type: row.entry_type, from: answer(data, 'from'), to: answer(data, 'to') || 'current' };
    if (entry.type === 'owner') {
      const share = options.share;
      if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0 || share > 100) throw new OccupancyReviewError('an owner\'s share must be a percent above 0 and at most 100');
      entry.share = share;
    }
    const problem = this.options.checkEntry(entry);
    if (problem) throw new OccupancyReviewError(problem);
    const existing = matches.length === 1 ? await doors.findPerson(ctx, username) : null;
    if (matches.length === 1 && !existing) throw new OccupancyReviewError(`${username} has no identity record to hold the details`);

    const { metadata: whoMetadata, ...who } = this.options.host.actorOf(ctx);
    const record = (result: 'success' | 'failure', reason?: string): OccupancyAuditRecord => ({
      eventType: this.options.host.addonAuditEventName('association-review'),
      ...who,
      result,
      action: 'occupancy-approve', severity: 'medium', resource: row.unit, resourceType: 'accommodation',
      metadata: { ...whoMetadata, submissionId: id, entryType: row.entry_type, username, owner: username, newAccount: matches.length === 0, ...(reason ? { reason } : {}) }
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
        await doors.createUser(ctx, { username, email, displayName });
        invitation = await doors.inviteUser(ctx, username);
        person = await doors.findPerson(ctx, username);
        if (!person) throw new Error(`${username} has no identity record to hold the details`);
      } catch (err) {
        return failed(`the account ${username} was not made ready: ${err instanceof Error ? err.message : String(err)}`, err);
      }
    }
    const kept0 = person!;

    let at: EntryRef | undefined;
    try {
      at = await doors.addEntry(ctx, username, entry);
    } catch (err) {
      return failed(`the entry was not added: ${err instanceof Error ? err.message : String(err)}`, err);
    }

    const details = doors.contactDetails(data);
    const written = new Set(details.contactPoint.map(c => c.contactType ?? ''));
    const kept = (kept0.contactPoint ?? []).filter(c => !written.has(String((c as Record<string, unknown>)['contactType'])));
    try {
      await doors.updatePerson(ctx, kept0.id, { ...(details.address ? { address: details.address } : {}), contactPoint: [...kept, ...details.contactPoint] });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      try {
        if (at) await doors.removeEntry(ctx, username, at);
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
    return { username, created: matches.length === 0, ...(invitation ? { invitation } : {}) };
  }

  /** The accounts whose email is exactly this one, found as the reviewer. */
  private async accountsFor(ctx: ActorContext, email: string): Promise<Array<{ username: string }>> {
    const doors = this.options.approval!;
    return (await doors.searchUsers(ctx, email)).filter(u => (u.email ?? '').trim().toLowerCase() === email.toLowerCase());
  }

  /** Ask the decision point for association-review with the caller's context; a "no" throws. */
  private async authorize(ctx: ActorContext): Promise<void> {
    const decision = await this.options.decide(ctx, { action: 'association-review' });
    if (!decision.permit) throw new OccupancyRefusedError('association-review', decision);
  }

  /** How many submissions wait for review. */
  pendingCount(): number {
    const row = this.options.db.prepare(`SELECT COUNT(*) AS n FROM association_occupancy_submissions WHERE status = 'pending'`).get() as { n: number };
    return row.n;
  }
}
