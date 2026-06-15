-- ============================================================================
-- ApexMaths — Aurora PostgreSQL schema (single consolidated baseline)
-- ============================================================================
--
-- This is the complete, current schema. The earlier incremental migrations
-- (the original 001 base schema + 005 completion + 006 subscription event
-- ordering) have been squashed into this one baseline. Applied by
-- scripts/migrate.mjs, which globs scripts/sql/*.sql, splits each file into
-- individual statements (respecting dollar-quoted blocks, single-quoted strings
-- and line comments) and executes them one-by-one (NOT wrapped in a single
-- transaction).
--
-- Running it is idempotent: every CREATE uses IF NOT EXISTS / duplicate_object
-- guards, so re-running against an already-migrated database is a safe no-op.
-- (Note: on an EXISTING database this baseline will NOT retro-add columns to a
-- table that already exists — it is the from-scratch definition. Live DBs are
-- already migrated; this file is the source of truth for a FRESH install.)
--
-- ID CONVENTION (do not change): ALL id and *_id columns are TEXT, never UUID.
--   * parents.id          = Cognito `sub` (opaque string)
--   * questions.id        = stable human id (e.g. "q-m1-002")
--   * everything else     = gen_random_uuid()::text (uuid VALUE stored as text)
--   WHY: the RDS Data API binds every id as a string; a real `uuid` column
--   compared to a bound string fails with "operator does not exist: uuid = text".
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ---- Enums ----
DO $$ BEGIN
  CREATE TYPE topic AS ENUM (
    'number','fractions_decimals_percentages','ratio_proportion','algebra','geometry','data_handling'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE session_type AS ENUM ('warmup','topic','mock');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM ('active','completed','expired','abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('trialing','active','past_due','canceled','incomplete','unpaid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mastery_classification AS ENUM ('needs_focus','developing','strong','insufficient_data');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- Parents (identity provided by Cognito; id = Cognito sub) ----
CREATE TABLE IF NOT EXISTS parents (
  id                 TEXT PRIMARY KEY, -- Cognito sub (opaque string id)
  email              TEXT NOT NULL,
  guardian_attested  BOOLEAN NOT NULL DEFAULT FALSE,
  age_attested       BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_customer_id TEXT UNIQUE,
  has_used_trial     BOOLEAN NOT NULL DEFAULT FALSE, -- server-only; never client-serialised
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

-- ---- Subscriptions (server/webhook-writable only) ----
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  parent_id              TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  status                 subscription_status NOT NULL DEFAULT 'incomplete',
  price_id               TEXT,
  current_period_end     TIMESTAMPTZ,
  trial_end              TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  status_event_at        TIMESTAMPTZ, -- Stripe event ts; reject older-than-last events
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_parent ON subscriptions(parent_id);

-- ---- Children (no PII beyond display name; max 3 enforced in app) ----
CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  parent_id    TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  year_group   INT CHECK (year_group IS NULL OR year_group BETWEEN 4 AND 6),
  avatar_color TEXT NOT NULL DEFAULT 'teal',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id) WHERE deleted_at IS NULL;

-- ---- Question bank (SERVER ONLY — never exposed with correct_index mid-session) ----
CREATE TABLE IF NOT EXISTS questions (
  id                TEXT PRIMARY KEY,
  text              TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  options           JSONB NOT NULL, -- string[] of 3-5 items
  correct_index     INT NOT NULL CHECK (correct_index >= 0),
  topic             topic NOT NULL,
  difficulty        INT NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  image_url         TEXT,
  image_description TEXT,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic) WHERE active;

-- ---- Practice sessions ----
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  child_id           TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  parent_id          TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  type               session_type NOT NULL,
  topic              topic, -- null for mixed sessions
  question_ids       JSONB NOT NULL, -- ordered string[] of question ids
  status             session_status NOT NULL DEFAULT 'active',
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  completed_at       TIMESTAMPTZ,
  time_limit_seconds INT NOT NULL,
  help_used          INT NOT NULL DEFAULT 0,
  score              INT,
  total              INT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_child ON sessions(child_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);

-- Hard one-active-session-per-child invariant. A second concurrent INSERT with
-- status='active' fails at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_session_per_child
  ON sessions(child_id) WHERE status = 'active';

-- ---- Per-question answers ----
CREATE TABLE IF NOT EXISTS session_answers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id    TEXT NOT NULL REFERENCES questions(id),
  position       INT NOT NULL,
  selected_index INT,
  is_correct     BOOLEAN,
  topic          topic NOT NULL,
  answered_at    TIMESTAMPTZ,
  UNIQUE (session_id, position)
);
CREATE INDEX IF NOT EXISTS idx_answers_session ON session_answers(session_id);

-- ---- Topic-level progress (aggregated from completed sessions only) ----
CREATE TABLE IF NOT EXISTS progress (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  child_id       TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  topic          topic NOT NULL,
  attempts       INT NOT NULL DEFAULT 0,
  correct        INT NOT NULL DEFAULT 0,
  mastery_score  NUMERIC(5,2) NOT NULL DEFAULT 0,
  classification mastery_classification NOT NULL DEFAULT 'needs_focus',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, topic)
);

-- ---- AI review reports (one per completed session) ----
-- generated_by is a provenance sentinel: 'nova' = an AI model produced at least
-- one explanation, 'fallback' = every item used deterministic text. ('nova' is
-- a historical label kept for the persisted column and the admin dashboard; the
-- model is now Claude Sonnet 4.6.)
CREATE TABLE IF NOT EXISTS review_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id   TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  summary      JSONB NOT NULL,
  generated_by TEXT NOT NULL DEFAULT 'nova', -- 'nova' | 'fallback'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Append-only audit log (server writes only) ----
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  parent_id  TEXT,
  child_id   TEXT,
  action     TEXT NOT NULL,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_parent ON audit_log(parent_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ---- Stripe webhook idempotency ----
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Revenue tracker (from invoice.paid) ----
CREATE TABLE IF NOT EXISTS revenue_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  parent_id         TEXT REFERENCES parents(id) ON DELETE SET NULL,
  stripe_invoice_id TEXT UNIQUE,
  amount_pence      INT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'gbp',
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Singleton revenue summary (id is always 'current') ----
CREATE TABLE IF NOT EXISTS revenue_summary (
  id                  TEXT PRIMARY KEY DEFAULT 'current',
  total_revenue_pence BIGINT NOT NULL DEFAULT 0,
  paying_parent_count INT NOT NULL DEFAULT 0,
  first_paid_at       TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- OPTIONAL TEARDOWN (for a true wipe). Uncomment and run BEFORE the CREATEs
-- above if you want to drop everything first. DESTRUCTIVE — deletes all data.
-- ============================================================================
-- DROP TABLE IF EXISTS revenue_summary, revenue_events, processed_webhook_events,
--   audit_log, review_reports, progress, session_answers, sessions, questions,
--   children, subscriptions, parents CASCADE;
-- DROP TYPE IF EXISTS mastery_classification, subscription_status, session_status,
--   session_type, topic CASCADE;
