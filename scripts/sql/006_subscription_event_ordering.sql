-- Out-of-order webhook protection for subscription lifecycle events.
--
-- Stripe does NOT guarantee event delivery order. Under retries, an older
-- customer.subscription.updated (status=active) can arrive AFTER a newer
-- customer.subscription.deleted (status=canceled), which would otherwise
-- re-grant access to a parent whose subscription has ended.
--
-- We record the Stripe event timestamp on the subscription row and refuse to
-- apply any event whose timestamp is older than the last one applied.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS status_event_at TIMESTAMPTZ;
