-- Wave 5 · Telegram batch ingest.
--
-- Extiende `telegram_pending` con columnas para agrupar items de un mismo
-- batch (screenshot, texto multi-item) y trackear estado por item: si es
-- duplicado de una tx existente, si el AI sospecha que es un transfer
-- interno, si el usuario lo excluyó manualmente, y a qué wallet contraparte
-- apunta cuando se marca como transfer.
--
-- También crea `telegram_chat_state`: una mini-tabla key-value por chat
-- usada para implementar "modo exclusión" y "modo transfer" sin
-- conversations de grammY. Expira en 2 minutos.

alter table telegram_pending
  add column batch_id uuid,
  add column batch_index int,
  add column is_duplicate boolean not null default false,
  add column transfer_hint boolean not null default false,
  add column excluded boolean not null default false,
  add column telegram_message_id bigint,
  add column duplicate_of_tx_id uuid references transactions(id) on delete set null,
  add column counterpart_wallet_id uuid references wallets(id) on delete set null;

create index idx_telegram_pending_batch on telegram_pending(batch_id)
  where batch_id is not null;

create index idx_telegram_pending_msg on telegram_pending(telegram_chat_id, telegram_message_id)
  where telegram_message_id is not null;

create table telegram_chat_state (
  telegram_chat_id bigint primary key,
  awaiting_exclude_batch_id uuid,
  awaiting_transfer_batch_id uuid,
  set_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes'
);

alter table telegram_chat_state enable row level security;
-- service-role only, sin políticas públicas
