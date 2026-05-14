-- Schema base del expense tracker

create extension if not exists "pgcrypto";

-- ============ ENUMS ============
create type wallet_type as enum (
  'general','cash','bank','credit_card','savings','investment'
);
create type category_type as enum ('expense','income');
create type tx_type as enum ('expense','income','transfer');
create type tx_source as enum (
  'manual','telegram_text','telegram_photo','telegram_audio'
);

-- ============ TABLES ============

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  main_currency char(3) not null default 'ARS',
  locale text not null default 'es-AR',
  created_at timestamptz not null default now()
);

create table wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type wallet_type not null default 'general',
  currency char(3) not null default 'ARS',
  initial_balance numeric(15,2) not null default 0,
  color text not null default '#6366f1',
  icon text not null default 'wallet',
  excluded_from_stats boolean not null default false,
  archived boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type category_type not null,
  parent_id uuid references categories(id) on delete cascade,
  color text not null default '#6366f1',
  icon text not null default 'tag',
  position int not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references wallets(id) on delete restrict,
  category_id uuid references categories(id) on delete set null,
  type tx_type not null,
  amount numeric(15,2) not null check (amount > 0),
  currency char(3) not null,
  occurred_at timestamptz not null default now(),
  description text,
  note text,
  payee text,
  photo_path text,
  transfer_group_id uuid,
  counterpart_wallet_id uuid references wallets(id),
  counterpart_amount numeric(15,2),
  counterpart_currency char(3),
  fx_rate numeric(20,10),
  source tx_source not null default 'manual',
  source_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tx_user_date    on transactions(user_id, occurred_at desc);
create index idx_tx_wallet       on transactions(wallet_id);
create index idx_tx_category     on transactions(category_id);
create index idx_tx_transfer_grp on transactions(transfer_group_id)
  where transfer_group_id is not null;

create table telegram_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_user_id bigint not null unique,
  telegram_username text,
  default_wallet_id uuid references wallets(id) on delete set null,
  linked_at timestamptz not null default now()
);

create table telegram_link_codes (
  code char(6) primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table fx_rates (
  rate_date date not null,
  base char(3) not null,
  quote char(3) not null,
  rate numeric(20,10) not null,
  fetched_at timestamptz not null default now(),
  primary key (rate_date, base, quote)
);

-- ============ TRIGGERS ============
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger wallets_updated      before update on wallets
  for each row execute function set_updated_at();
create trigger transactions_updated before update on transactions
  for each row execute function set_updated_at();
