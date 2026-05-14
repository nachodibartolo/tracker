-- Row-Level Security: cada usuario sólo ve sus propias filas

alter table profiles            enable row level security;
alter table wallets             enable row level security;
alter table categories          enable row level security;
alter table transactions        enable row level security;
alter table telegram_users      enable row level security;
alter table telegram_link_codes enable row level security;
alter table fx_rates            enable row level security;

create policy "own profile"
  on profiles
  for all
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "own wallets"
  on wallets
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own categories"
  on categories
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own transactions"
  on transactions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own telegram link"
  on telegram_users
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own telegram codes"
  on telegram_link_codes
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- fx_rates es global; sólo lectura para authenticated (lo escribe service-role)
create policy "read fx rates"
  on fx_rates
  for select
  to authenticated
  using (true);
