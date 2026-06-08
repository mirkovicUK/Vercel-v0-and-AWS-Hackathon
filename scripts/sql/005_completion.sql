-- 005_completion.sql — practice-billing-gdpr-completion
--
-- Completion migration for the practice/billing/GDPR work. Applied by
-- scripts/migrate.mjs, which splits this file into individual statements
-- (respecting $$ blocks, ' strings and -- comments) and executes each one
-- SEPARATELY — they are NOT wrapped in a single transaction.
--
-- Why that matters: `ALTER TYPE ... ADD VALUE` is forbidden by Postgres inside
-- a transaction block. Because each statement below runs on its own, the enum
-- extension is safe. Keep every statement terminated by its own `;` so the
-- runner continues to treat them individually.
--
-- ID CONVENTION (see 001_schema.sql): all id/FK columns stay TEXT — no new
-- `uuid` column types are introduced here.

-- Req 1: server-only trial flag on parents (default FALSE, never client-serialised).
ALTER TABLE parents ADD COLUMN IF NOT EXISTS has_used_trial BOOLEAN NOT NULL DEFAULT FALSE;

-- Req 20: add the `insufficient_data` band to the mastery enum.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; the migrate
-- runner executes each statement individually, so this is safe as its own
-- statement. IF NOT EXISTS makes re-runs idempotent.
ALTER TYPE mastery_classification ADD VALUE IF NOT EXISTS 'insufficient_data';

-- Req 19: narrow children.year_group from 3..8 down to 4..6.
-- Existing rows outside 4..6 (e.g. Year 3 or 7/8 from the old UI) must be
-- reconciled before the new CHECK can be added, otherwise the ALTER fails on
-- pre-existing data. We null those out, then swap the constraint.
UPDATE children SET year_group = NULL WHERE year_group IS NOT NULL AND year_group NOT BETWEEN 4 AND 6;

-- The original column-level CHECK in 001_schema.sql is anonymous, so Postgres
-- auto-named it `children_year_group_check` (table_column_check convention).
-- DROP ... IF EXISTS uses that conventional name. If a deployed environment has
-- a different auto-generated name, look it up in
-- information_schema.table_constraints (constraint_type='CHECK') for the
-- `children` table and drop the actual name before re-running.
ALTER TABLE children DROP CONSTRAINT IF EXISTS children_year_group_check;
ALTER TABLE children ADD CONSTRAINT children_year_group_check CHECK (year_group IS NULL OR year_group BETWEEN 4 AND 6);

-- Req 4: hard one-active-session-per-child invariant (partial unique index).
-- Even under a concurrent double-submit, the second INSERT with status='active'
-- fails at the DB and is surfaced as "you already have an active session".
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_session_per_child
  ON sessions(child_id) WHERE status = 'active';

-- Req 10: singleton revenue summary (id is always 'current').
CREATE TABLE IF NOT EXISTS revenue_summary (
  id                  TEXT PRIMARY KEY DEFAULT 'current',
  total_revenue_pence BIGINT NOT NULL DEFAULT 0,
  paying_parent_count INT NOT NULL DEFAULT 0,
  first_paid_at       TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
