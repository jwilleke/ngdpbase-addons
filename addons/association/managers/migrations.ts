/**
 * The association database's migration ledger. Run by ngdpbase's DatabaseManager through
 * `openAddonDatabase('association', …)` and recorded in `association_schema_migrations`.
 * Each entry is a frozen snapshot of what it did on its date: never edited after it ships;
 * a change is a new, later entry. Every table starts with `association_`.
 */

/** The slice of the SQLite handle a migration uses. */
export interface MigrationDb {
  exec(sql: string): unknown;
}

export interface AssociationMigration {
  /** YYYYMMDDHHMMSS, strictly ascending. */
  id: string;
  description: string;
  up: (db: MigrationDb) => void;
}

/** The record table for this add-on's ledger. */
export const ASSOCIATION_LEDGER_TABLE = 'association_schema_migrations';

const OCCUPANCY_SUBMISSIONS: AssociationMigration = {
  id: '20261024120000',
  description: 'Occupancy information submissions kept for review (#32)',
  up: (db) => {
    db.exec(`
      CREATE TABLE association_occupancy_submissions (
        id           TEXT PRIMARY KEY,
        received_at  TEXT NOT NULL,
        submitted_by TEXT NOT NULL,
        form_version TEXT NOT NULL DEFAULT '',
        unit         TEXT NOT NULL,
        entry_type   TEXT NOT NULL CHECK (entry_type IN ('owner', 'occupant')),
        answers      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))
      );
      CREATE INDEX association_occupancy_submissions_status ON association_occupancy_submissions (status, received_at);
    `);
  }
};

export const ASSOCIATION_MIGRATIONS: AssociationMigration[] = [OCCUPANCY_SUBMISSIONS];
