-- Wave 4A · Transfers between wallets.
--
-- Adds a `transfer_direction` column to `transactions` so we can tell apart
-- the two legs each transfer produces. Replaces the Wave 2A `wallet_balance()`
-- function with a transfer-aware version, and exposes two RPCs that
-- create/delete transfer pairs atomically.

-- =============================================================================
-- 1. transfer_direction column
-- =============================================================================
-- Each transfer inserts TWO rows sharing a `transfer_group_id`. The amounts
-- are stored positively on both rows; `transfer_direction` decides whether the
-- amount should subtract from ('out') or add to ('in') the wallet's balance.
--
-- Non-transfer rows MUST keep `transfer_direction = null` — enforced by the
-- pairing CHECK below.

alter table public.transactions
  add column if not exists transfer_direction text;

-- Drop any pre-existing matching constraints idempotently so re-applying the
-- migration is safe (e.g. during local dev). Using DO blocks because plain
-- `drop constraint if exists` on names we don't fully control is brittle.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'transactions_transfer_direction_check'
  ) then
    alter table public.transactions
      drop constraint transactions_transfer_direction_check;
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'transactions_transfer_direction_pairing'
  ) then
    alter table public.transactions
      drop constraint transactions_transfer_direction_pairing;
  end if;
end$$;

alter table public.transactions
  add constraint transactions_transfer_direction_check
  check (transfer_direction is null or transfer_direction in ('out', 'in'));

alter table public.transactions
  add constraint transactions_transfer_direction_pairing
  check (
    (type = 'transfer' and transfer_direction is not null)
    or (type <> 'transfer' and transfer_direction is null)
  );

-- Helpful index for listing/deleting transfer groups.
create index if not exists idx_tx_transfer_direction
  on public.transactions(transfer_group_id, transfer_direction)
  where transfer_group_id is not null;

-- =============================================================================
-- 2. Transfer-aware wallet_balance()
-- =============================================================================
-- Replaces the Wave 2A version (which ignored transfers). Same signature, same
-- semantics for income/expense; transfer rows now contribute according to
-- `transfer_direction`.

create or replace function public.wallet_balance(p_wallet_id uuid)
  returns numeric
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select w.initial_balance + coalesce(sum(
    case
      when t.type = 'income' then t.amount
      when t.type = 'expense' then -t.amount
      when t.type = 'transfer' and t.transfer_direction = 'in'  then t.amount
      when t.type = 'transfer' and t.transfer_direction = 'out' then -t.amount
      else 0
    end
  ), 0)
  from public.wallets w
  left join public.transactions t on t.wallet_id = w.id
  where w.id = p_wallet_id
  group by w.initial_balance;
$$;

comment on function public.wallet_balance(uuid) is
  'Wallet balance in its own currency. Sums income + expense + transfer legs '
  '(based on transfer_direction). Wave 4A.';

grant execute on function public.wallet_balance(uuid) to authenticated;

-- =============================================================================
-- 3. create_transfer() RPC
-- =============================================================================
-- Inserts the two-row transfer atomically. Ownership is enforced server-side:
-- both wallets must belong to `p_user_id` or the function raises.
--
-- Returns the freshly-generated `transfer_group_id` so the caller can immediately
-- read the resulting rows.

create or replace function public.create_transfer(
  p_user_id uuid,
  p_from_wallet uuid,
  p_to_wallet uuid,
  p_amount_from numeric,
  p_amount_to numeric,
  p_currency_from char(3),
  p_currency_to char(3),
  p_fx_rate numeric,
  p_occurred_at timestamptz,
  p_note text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid := gen_random_uuid();
  v_from_count int;
  v_to_count int;
  v_occurred timestamptz := coalesce(p_occurred_at, now());
begin
  if p_from_wallet = p_to_wallet then
    raise exception 'Las wallets de origen y destino deben ser distintas';
  end if;

  if p_amount_from is null or p_amount_from <= 0 then
    raise exception 'El monto debe ser mayor a 0';
  end if;

  if p_amount_to is null or p_amount_to <= 0 then
    raise exception 'El monto recibido debe ser mayor a 0';
  end if;

  -- Verify wallet ownership. Counting rather than selecting keeps things
  -- short; the unique-PK guarantees the count is 0 or 1.
  select count(*) into v_from_count
    from public.wallets
    where id = p_from_wallet and user_id = p_user_id;
  if v_from_count = 0 then
    raise exception 'Wallet de origen inválida';
  end if;

  select count(*) into v_to_count
    from public.wallets
    where id = p_to_wallet and user_id = p_user_id;
  if v_to_count = 0 then
    raise exception 'Wallet de destino inválida';
  end if;

  -- OUT leg (source pays).
  insert into public.transactions (
    user_id, wallet_id, category_id, type, amount, currency,
    occurred_at, note,
    transfer_group_id, transfer_direction,
    counterpart_wallet_id, counterpart_amount, counterpart_currency, fx_rate,
    source
  ) values (
    p_user_id, p_from_wallet, null, 'transfer', p_amount_from, p_currency_from,
    v_occurred, p_note,
    v_group, 'out',
    p_to_wallet, p_amount_to, p_currency_to, p_fx_rate,
    'manual'
  );

  -- IN leg (destination receives). Counterpart fields mirror the OUT leg.
  insert into public.transactions (
    user_id, wallet_id, category_id, type, amount, currency,
    occurred_at, note,
    transfer_group_id, transfer_direction,
    counterpart_wallet_id, counterpart_amount, counterpart_currency, fx_rate,
    source
  ) values (
    p_user_id, p_to_wallet, null, 'transfer', p_amount_to, p_currency_to,
    v_occurred, p_note,
    v_group, 'in',
    p_from_wallet, p_amount_from, p_currency_from, p_fx_rate,
    'manual'
  );

  return v_group;
end;
$$;

grant execute on function public.create_transfer(
  uuid, uuid, uuid, numeric, numeric, char, char, numeric, timestamptz, text
) to authenticated;

-- =============================================================================
-- 4. delete_transfer() RPC
-- =============================================================================
-- Deletes both legs of a transfer in one go. Ownership is verified by scoping
-- the delete to `user_id = p_user_id`; if no rows match the function raises.

create or replace function public.delete_transfer(
  p_user_id uuid,
  p_group_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.transactions
    where transfer_group_id = p_group_id
      and user_id = p_user_id
      and type = 'transfer';
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'Transferencia no encontrada';
  end if;
end;
$$;

grant execute on function public.delete_transfer(uuid, uuid) to authenticated;
