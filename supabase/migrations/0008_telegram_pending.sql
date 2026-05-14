-- Wave 4C · Telegram pending confirmations.
--
-- Buffers AI-extracted gasto / ingreso suggestions that originated from a
-- Telegram message (text / photo / voice) while the user reviews them. When
-- the user taps "Confirmar" in the inline keyboard, the bot turns this row
-- into a real `transactions` insert and deletes the pending. "Cancelar" just
-- deletes the row. Stale rows are reaped by a cron (out of scope here) using
-- `expires_at`.
--
-- Only the service-role writes/reads this table — there's no first-party
-- client UI for it — so we enable RLS without creating any public policy.

create table telegram_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_chat_id bigint not null,
  extraction jsonb not null,
  photo_path text,
  suggested_wallet_id uuid references wallets(id) on delete set null,
  suggested_category_id uuid references categories(id) on delete set null,
  source tx_source not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

alter table telegram_pending enable row level security;
-- No public policy; service-role writes/reads only.
