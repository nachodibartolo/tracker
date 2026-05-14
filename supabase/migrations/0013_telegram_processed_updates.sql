-- 0013_telegram_processed_updates.sql
-- Idempotency table for the Telegram webhook.
--
-- Telegram retries webhook delivery (with exponential backoff) whenever it
-- doesn't get a prompt 2xx response. Without dedup, every retry re-runs the
-- agent and produces another reply. We insert the `update_id` here on first
-- delivery; conflicting inserts (PK violation) signal a retry that we skip.
--
-- Rows are pruned by the existing daily cron (`/api/cron/refresh-fx`).

create table public.telegram_processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

create index telegram_processed_updates_processed_at_idx
  on public.telegram_processed_updates (processed_at);

alter table public.telegram_processed_updates enable row level security;
-- No SELECT/INSERT policies on purpose: only the service role (which bypasses
-- RLS) writes to and reads from this table. End-user clients have no business
-- here.
