-- Wave 2A · Wallet helper functions.
--
-- Provides `wallet_balance(p_wallet_id uuid)` returning the current balance for
-- a wallet in its own currency. The balance is:
--
--   initial_balance
--     + Σ amount where type='income'
--     − Σ amount where type='expense'
--
-- =============================================================================
-- Wave 4A extension point (Transfers)
-- =============================================================================
-- Wave 4A introduces the `create_transfer` RPC which writes TWO transaction
-- rows (one per wallet leg) sharing the same `transfer_group_id`. Each leg
-- stores a positive `amount` representing the value flowing through that
-- wallet, plus `counterpart_wallet_id` / `counterpart_amount` pointing to the
-- opposite leg.
--
-- When Wave 4A lands, this function should be extended so that transfer rows
-- contribute as follows:
--
--   • the OUTGOING leg (wallet pays out)  →  subtract `amount`
--   • the INCOMING leg (wallet receives)  →  add `amount`
--
-- The recommended way to distinguish legs is to add a stored boolean column,
-- e.g. `is_transfer_out boolean`, populated by the RPC; or to compare each
-- row's `wallet_id` against the matching `counterpart_wallet_id` in the
-- transfer group. Either way, the change is local to this function — the
-- contract `wallet_balance(uuid) → numeric` stays the same.
--
-- For Wave 2A there are no transfers yet, so transfer rows are simply ignored.
-- =============================================================================

create or replace function public.wallet_balance(p_wallet_id uuid)
  returns numeric
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select
    coalesce(w.initial_balance, 0)
    + coalesce((
        select sum(
          case t.type
            when 'income'   then t.amount
            when 'expense'  then -t.amount
            -- 'transfer' is intentionally ignored until Wave 4A — see header.
            else 0
          end
        )
        from public.transactions t
        where t.wallet_id = w.id
      ), 0)
  from public.wallets w
  where w.id = p_wallet_id;
$$;

comment on function public.wallet_balance(uuid) is
  'Computes a wallet''s balance in its own currency. Wave 2A scope: '
  'initial_balance + Σ income − Σ expense. Transfers are added in Wave 4A.';

-- Allow authenticated users to call the function for their own wallets. RLS
-- on `wallets` and `transactions` already restricts visibility, and the
-- function runs as `security invoker`, so callers only see rows they own.
grant execute on function public.wallet_balance(uuid) to authenticated;
