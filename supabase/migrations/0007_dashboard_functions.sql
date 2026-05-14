-- Wave 4B · Dashboard aggregation functions.
--
-- These functions provide grouped sums for the dashboard widgets. They never
-- perform FX conversion in SQL — the caller batches `fx_rates` lookups in JS
-- via `lib/fx/convert.ts::convertMany()` and converts the per-currency totals
-- there. This keeps the SQL side simple, RLS-safe, and free of date-sensitive
-- math.
--
-- All functions run as `security invoker`, so the caller's RLS policies on
-- `wallets`/`transactions` already scope the rows visible to them. The
-- explicit `p_user_id` parameter is a defence-in-depth filter so the function
-- can also be used from service-role contexts (cron, telegram) without
-- leaking other users' data.
--
-- Transfers (Wave 4A): the `transactions` table is expected to have a
-- `transfer_direction` column populated by `create_transfer()` — `'in'` for
-- the incoming leg, `'out'` for the outgoing leg. Migration 0006 (Track 4A)
-- adds the column; since Supabase applies migrations in lexicographic order
-- 0006 lands before 0007. If 0006 hasn't landed yet, the references below to
-- `t.transfer_direction` will fail at function-call time, not at migration
-- time — these are SQL functions, not plpgsql, so they're parsed lazily and
-- only validated when invoked. That gives us a clean rollout window.

-- =============================================================================
-- wallet_balances(p_user_id)
-- =============================================================================
-- Returns one row per wallet with the wallet's balance in its own currency
-- (no FX). Used by the dashboard to feed the multi-currency `convertMany`
-- pipeline; faster than calling `wallet_balance()` once per wallet.
create or replace function public.wallet_balances(p_user_id uuid)
  returns table(wallet_id uuid, currency char(3), balance numeric)
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select
    w.id as wallet_id,
    w.currency,
    coalesce(w.initial_balance, 0)
      + coalesce((
          select sum(
            case
              when t.type = 'income'  then t.amount
              when t.type = 'expense' then -t.amount
              when t.type = 'transfer' and t.transfer_direction = 'in'  then t.amount
              when t.type = 'transfer' and t.transfer_direction = 'out' then -t.amount
              else 0
            end
          )
          from public.transactions t
          where t.wallet_id = w.id
        ), 0) as balance
  from public.wallets w
  where w.user_id = p_user_id
    and w.archived = false
    and w.excluded_from_stats = false;
$$;

comment on function public.wallet_balances(uuid) is
  'Per-wallet balance in its own currency for non-archived, non-excluded '
  'wallets. Caller converts to the user main_currency in JS.';

grant execute on function public.wallet_balances(uuid) to authenticated;


-- =============================================================================
-- expenses_by_category(p_user_id, p_from, p_to)
-- =============================================================================
-- Sums expense transactions per category within the date range. Currency is
-- preserved (one row per (category, currency) pair) so the caller can convert
-- via `convertMany` and aggregate. Wallets flagged `excluded_from_stats` are
-- skipped so the user can hide e.g. an investment account from charts.
create or replace function public.expenses_by_category(
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
  returns table(category_id uuid, total numeric, currency char(3))
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select
    t.category_id,
    sum(t.amount)::numeric as total,
    t.currency
  from public.transactions t
  join public.wallets w on w.id = t.wallet_id
  where t.user_id = p_user_id
    and t.type = 'expense'
    and t.occurred_at >= p_from
    and t.occurred_at <  p_to
    and w.excluded_from_stats = false
    and w.archived = false
  group by t.category_id, t.currency;
$$;

comment on function public.expenses_by_category(uuid, timestamptz, timestamptz) is
  'Per-(category, currency) expense totals for a date range. Skips wallets '
  'flagged excluded_from_stats or archived.';

grant execute on function public.expenses_by_category(uuid, timestamptz, timestamptz) to authenticated;


-- =============================================================================
-- monthly_summary(p_user_id, p_from, p_to)
-- =============================================================================
-- Returns income + expense totals for a date range, split per currency.
-- Transfers are intentionally excluded — they move money within the user's
-- wallets and shouldn't inflate "Income" or "Expenses".
create or replace function public.monthly_summary(
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
  returns table(income numeric, expense numeric, currency char(3))
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select
    coalesce(sum(case when t.type = 'income'  then t.amount else 0 end), 0)::numeric as income,
    coalesce(sum(case when t.type = 'expense' then t.amount else 0 end), 0)::numeric as expense,
    t.currency
  from public.transactions t
  join public.wallets w on w.id = t.wallet_id
  where t.user_id = p_user_id
    and t.occurred_at >= p_from
    and t.occurred_at <  p_to
    and t.type in ('income', 'expense')
    and w.excluded_from_stats = false
    and w.archived = false
  group by t.currency;
$$;

comment on function public.monthly_summary(uuid, timestamptz, timestamptz) is
  'Income and expense totals per currency for a date range. Transfers '
  'excluded; archived / excluded_from_stats wallets skipped.';

grant execute on function public.monthly_summary(uuid, timestamptz, timestamptz) to authenticated;


-- =============================================================================
-- daily_balance_series(p_user_id, p_currency, p_from, p_to)
-- =============================================================================
-- Returns the net daily delta (signed sum) for the user's wallets in
-- `p_currency`, restricted to the date range. Only includes wallets that
-- match `p_currency` because converting cross-currency transactions in SQL
-- would require date-aware FX lookups. The caller adds the initial balance
-- (also in `p_currency`) and computes cumulative sums in JS for the chart.
create or replace function public.daily_balance_series(
  p_user_id uuid,
  p_currency char(3),
  p_from date,
  p_to date
)
  returns table(day date, delta numeric)
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select
    (t.occurred_at at time zone 'UTC')::date as day,
    sum(
      case
        when t.type = 'income'  then t.amount
        when t.type = 'expense' then -t.amount
        when t.type = 'transfer' and t.transfer_direction = 'in'  then t.amount
        when t.type = 'transfer' and t.transfer_direction = 'out' then -t.amount
        else 0
      end
    )::numeric as delta
  from public.transactions t
  join public.wallets w on w.id = t.wallet_id
  where t.user_id = p_user_id
    and w.currency = p_currency
    and w.excluded_from_stats = false
    and w.archived = false
    and (t.occurred_at at time zone 'UTC')::date >= p_from
    and (t.occurred_at at time zone 'UTC')::date <= p_to
  group by (t.occurred_at at time zone 'UTC')::date
  order by (t.occurred_at at time zone 'UTC')::date;
$$;

comment on function public.daily_balance_series(uuid, char(3), date, date) is
  'Per-day net delta for the user''s wallets denominated in p_currency. '
  'Caller is responsible for adding the initial balance and computing the '
  'cumulative running total in JS.';

grant execute on function public.daily_balance_series(uuid, char(3), date, date) to authenticated;
