/**
 * OccupancyManager — the Occupancy information form's submissions (ORC 5311.09; #32).
 * Registered on the engine as 'OccupancyManager'.
 *
 * Every submission waits for review (17a): the handler checks the answers, records
 * `occupancy-submit` before it keeps anything (on-failure refuse), keeps the submission in
 * the add-on's encrypted database as pending, and tells the holders of `association-review`.
 * Nothing is applied to an account or an accommodation here; review is #33.
 *
 * The entry's dates and unit are checked by accommodation's own rule
 * (ResidencyManager.checkEntry), the one that applies them later, never a copy of it.
 */
import type { ActorContext, AddonHost } from '@jwilleke/ngdpbase-types';

/** The slice of the SQLite handle this manager uses. */
export interface OccupancyDb {
  prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown };
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

  /** How many submissions wait for review. */
  pendingCount(): number {
    const row = this.options.db.prepare(`SELECT COUNT(*) AS n FROM association_occupancy_submissions WHERE status = 'pending'`).get() as { n: number };
    return row.n;
  }
}
