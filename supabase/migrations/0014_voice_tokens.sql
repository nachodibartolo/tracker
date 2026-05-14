-- 0014_voice_tokens.sql
-- Personal Access Tokens for the voice / iOS Shortcut entry point.
--
-- Each row represents one device (or one Shortcut) authorized to call
-- `POST /api/voice/agent`. The plaintext token is shown to the user
-- ONCE at creation; only the sha256 hex hash is persisted.
--
-- Revocation is a soft-delete (`revoked_at`) so we keep `last_used_at`
-- for audit. The endpoint filters `revoked_at IS NULL`.

create table public.voice_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null,
  default_wallet_id uuid references public.wallets(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index voice_tokens_user_id_idx on public.voice_tokens(user_id);

alter table public.voice_tokens enable row level security;

-- Users can read their own tokens to render the management UI.
create policy "voice_tokens_owner_select" on public.voice_tokens
  for select using (auth.uid() = user_id);

-- Users can soft-revoke their own tokens.
create policy "voice_tokens_owner_update" on public.voice_tokens
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Inserts are done from server actions using the service-role client,
-- which bypasses RLS. No INSERT policy is intentional.
