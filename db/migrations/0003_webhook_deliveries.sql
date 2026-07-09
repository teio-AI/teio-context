-- Webhook idempotency (ARCHITECTURE §6): GitHub can redeliver a webhook.
-- We record each X-GitHub-Delivery id and skip a delivery we've already
-- processed, so a redelivery never double-reindexes or double-audits.
create table if not exists webhook_deliveries (
  delivery_id text primary key,
  event text not null,
  received_at timestamptz not null default now()
);
