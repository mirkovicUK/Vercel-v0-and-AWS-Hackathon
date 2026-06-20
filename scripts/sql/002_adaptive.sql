-- ============================================================================
-- 002_adaptive.sql — Adaptive "Skill builder" session type + recency index
-- ============================================================================
--
-- Applied by scripts/migrate.mjs, which globs scripts/sql/*.sql, splits each
-- file into individual statements and executes them ONE-BY-ONE (NOT wrapped in
-- a single transaction). That per-statement execution is REQUIRED here:
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, so this
-- file must NOT be wrapped in BEGIN/COMMIT.
--
-- Re-running is idempotent: IF NOT EXISTS guards on both statements make a
-- second run against an already-migrated database a safe no-op.
--
-- RECENCY INDEX RATIONALE (idx_answers_child_recent). The adaptive recency
-- anti-join is driven from `sessions` (where child_id lives) into
-- `session_answers` on session_id, filtered by a time window on answered_at:
--
--   FROM session_answers sa JOIN sessions s ON s.id = sa.session_id
--    WHERE s.child_id = :childId AND sa.answered_at >= now() - interval '1 day'
--
-- The leading column session_id is the join key back to sessions; the trailing
-- answered_at lets the range filter be satisfied within the index per session.
-- question_id (the anti-join projection) is then fetched via the heap for the
-- small surviving row set.
--
-- DENORMALISING child_id ONTO session_answers — considered, DEFERRED for v1.
-- A single-column (child_id, answered_at) index would let the recency lookup
-- hit session_answers directly and skip the join, which is strictly faster at
-- very large scale. We deliberately do NOT adopt it for v1 because it would
-- require a new child_id column on session_answers, a write-time copy of
-- child_id on every answer insert, and a backfill of existing rows — all beyond
-- this feature's scope. The composite (session_id, answered_at) index satisfies
-- the query shape with zero denormalisation, zero write-path change, and zero
-- backfill; the join to sessions is on its indexed primary key.
-- ============================================================================

-- Req 1.7: extend the session_type enum. IF NOT EXISTS makes re-runs a no-op.
ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'adaptive';

-- Req 10: recency anti-join index. Leading column = join key (session_id),
-- trailing column = answered_at for the range filter; question_id is fetched
-- via the heap for the anti-join result set.
CREATE INDEX IF NOT EXISTS idx_answers_child_recent
  ON session_answers (session_id, answered_at);
