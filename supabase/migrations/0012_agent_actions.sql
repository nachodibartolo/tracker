-- 0012_agent_actions.sql
-- Audit log for writes performed by the Telegram agent + RPC for the
-- read-only SQL escape hatch.

create table public.telegram_agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_chat_id bigint not null,
  action_type text not null check (action_type in ('create','update','delete')),
  target_table text not null default 'transactions',
  target_ids uuid[] not null,
  before_payload jsonb,
  after_payload jsonb,
  agent_summary text,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by_action_id uuid references public.telegram_agent_actions(id)
);

create index telegram_agent_actions_user_reversible_idx
  on public.telegram_agent_actions (user_id, created_at desc)
  where reversed_at is null;

alter table public.telegram_agent_actions enable row level security;

create policy "users see own agent actions"
  on public.telegram_agent_actions
  for select
  using (auth.uid() = user_id);

-- Read-only SQL escape hatch. Caller must pass user_id explicitly; the SQL
-- itself must reference $1 as the user_id placeholder. We parse the SQL for
-- forbidden keywords as a second line of defense (the TS layer validates
-- first; the RPC must not trust its caller).
create or replace function public.agent_readonly_query(p_sql text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_sql is null or length(trim(p_sql)) = 0 then
    raise exception 'agent_readonly_query: empty sql';
  end if;
  if p_sql ~* '\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|CALL|MERGE|REPLACE|VACUUM|REINDEX)\b' then
    raise exception 'agent_readonly_query: forbidden keyword';
  end if;
  if p_sql ~ ';\s*\S' then
    raise exception 'agent_readonly_query: multiple statements not allowed';
  end if;
  if p_sql !~* '^\s*(WITH|SELECT)\s' then
    raise exception 'agent_readonly_query: must start with SELECT or WITH';
  end if;
  if p_sql !~* 'user_id\s*=\s*\$1' then
    raise exception 'agent_readonly_query: sql must filter by user_id = $1';
  end if;

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) as _inner limit 500) as t',
    p_sql
  )
    using p_user_id
    into result;
  return result;
end;
$$;

revoke all on function public.agent_readonly_query(text, uuid) from public;
grant execute on function public.agent_readonly_query(text, uuid) to service_role;
