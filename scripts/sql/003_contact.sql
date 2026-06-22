-- ============================================================================
-- 003_contact.sql — Parent Contact Inbox: public contact submissions table
-- ============================================================================
--
-- Applied by scripts/migrate.mjs, which globs scripts/sql/*.sql, splits each
-- file into individual statements and executes them ONE-BY-ONE (NOT wrapped in
-- a single transaction). This additive migration follows the 001_schema.sql
-- conventions exactly: CREATE TABLE/INDEX IF NOT EXISTS guards, TEXT ids
-- defaulting to gen_random_uuid()::text, TIMESTAMPTZ timestamps, and
-- ON DELETE SET NULL on the parents FK.
--
-- Re-running is idempotent: every CREATE uses IF NOT EXISTS, so a second run
-- against an already-migrated database is a safe no-op.
--
-- RELATIONAL LINKAGE: parent_id REFERENCES parents(id) ON DELETE SET NULL — a
-- signed-in submitter's message is attributed to their parent row; on erasure
-- the message is RETAINED but DE-ATTRIBUTED (the GDPR pattern, matching the
-- revenue_events precedent in 001_schema.sql). Logged-out submissions store
-- parent_id = NULL.
--
-- PII NOTE: source_ip is collected ONLY for the rate-limit count. It is never
-- selected by the inbox query and has no field in ContactInboxItem, so it can
-- never reach the admin view.
-- ============================================================================

CREATE TABLE IF NOT EXISTS contact_messages (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  parent_id  TEXT REFERENCES parents(id) ON DELETE SET NULL,   -- NULL when logged out (Req 3.1, 3.3, 3.5)
  name       TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),       -- Name_Bounds (Req 2.2)
  email      TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),            -- Email_Bounds (Req 2.3)
  message    TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 2000), -- Message_Bounds (Req 2.4)
  status     TEXT NOT NULL DEFAULT 'new',                       -- v1 is read-only; only 'new' is ever written (Req 2.6)
  source_ip  TEXT,                                              -- rate-limit only; never displayed (PII note above)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inbox read: most-recent-first, bounded (Req 8.1).
CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at DESC);

-- Rate-limit counts over the rolling window (Req 4.2, 4.3).
CREATE INDEX IF NOT EXISTS idx_contact_email_created ON contact_messages(email, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_ip_created    ON contact_messages(source_ip, created_at);

-- Sender-context join key (Req 8.2).
CREATE INDEX IF NOT EXISTS idx_contact_parent ON contact_messages(parent_id);
