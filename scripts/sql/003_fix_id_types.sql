-- Migration 003: change parent-related id columns from UUID to TEXT.
--
-- WHY: parents.id holds the Cognito `sub`, which is an opaque string. The
-- original schema typed it as UUID, so the RDS Data API failed to write the
-- parent row on sign-up/sign-in ("column id is of type uuid but expression is
-- of type text"). The fix is to store these ids as TEXT.
--
-- SAFE TO RUN: these tables are recreated from scratch. They contain no real
-- data yet (account creation was failing). The `questions` table is NOT touched.
--
-- This migration is idempotent: it drops and recreates the affected tables, so
-- re-running it simply rebuilds them empty.

-- Drop in dependency order (children/sessions reference parents; answers/progress
-- reference sessions/children; revenue/audit reference parents).
DROP TABLE IF EXISTS revenue_events CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS progress CASCADE;
DROP TABLE IF EXISTS review_reports CASCADE;
DROP TABLE IF EXISTS session_answers CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS children CASCADE;
DROP TABLE IF EXISTS parents CASCADE;

-- Recreate with TEXT ids where the Cognito sub is involved.

CREATE TABLE parents (
  id                 TEXT PRIMARY KEY, -- Cognito sub (opaque string id)
  email              TEXT NOT NULL,
  guardian_attested  BOOLEAN NOT NULL DEFAULT FALSE,
  age_attested       BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_customer_id TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id              TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  status                 subscription_status NOT NULL DEFAULT 'incomplete',
  price_id               TEXT,
  current_period_end     TIMESTAMPTZ,
  trial_end              TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_parent ON subscriptions(parent_id);

CREATE TABLE children (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  year_group   INT CHECK (year_group BETWEEN 3 AND 8),
  avatar_color TEXT NOT NULL DEFAULT 'teal',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id) WHERE deleted_at IS NULL;

CREATE TABLE sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id           UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  parent_id          TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  type               session_type NOT NULL,
  topic              topic,
  question_ids       JSONB NOT NULL,
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

CREATE TABLE session_answers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id    TEXT NOT NULL REFERENCES questions(id),
  position       INT NOT NULL,
  selected_index INT,
  is_correct     BOOLEAN,
  topic          topic NOT NULL,
  answered_at    TIMESTAMPTZ,
  UNIQUE (session_id, position)
);
CREATE INDEX IF NOT EXISTS idx_answers_session ON session_answers(session_id);

CREATE TABLE progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id       UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  topic          topic NOT NULL,
  attempts       INT NOT NULL DEFAULT 0,
  correct        INT NOT NULL DEFAULT 0,
  mastery_score  NUMERIC(5,2) NOT NULL DEFAULT 0,
  classification mastery_classification NOT NULL DEFAULT 'needs_focus',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, topic)
);

CREATE TABLE review_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  summary      JSONB NOT NULL,
  generated_by TEXT NOT NULL DEFAULT 'nova',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  parent_id  TEXT,
  child_id   TEXT,
  action     TEXT NOT NULL,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_parent ON audit_log(parent_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE revenue_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id         TEXT REFERENCES parents(id) ON DELETE SET NULL,
  stripe_invoice_id TEXT UNIQUE,
  amount_pence      INT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'gbp',
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
