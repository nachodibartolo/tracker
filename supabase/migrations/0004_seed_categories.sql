-- Seed de categorías default al crear un usuario nuevo

create or replace function seed_default_categories(p_user_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into categories (user_id, name, type, color, icon, is_system, position) values
    (p_user_id, 'Comida',          'expense', '#ef4444', 'fork-knife',      true, 1),
    (p_user_id, 'Transporte',      'expense', '#f59e0b', 'car',             true, 2),
    (p_user_id, 'Servicios',       'expense', '#3b82f6', 'plug',            true, 3),
    (p_user_id, 'Hogar',           'expense', '#8b5cf6', 'house',           true, 4),
    (p_user_id, 'Salud',           'expense', '#10b981', 'heartbeat',       true, 5),
    (p_user_id, 'Entretenimiento', 'expense', '#ec4899', 'film-strip',      true, 6),
    (p_user_id, 'Compras',         'expense', '#f97316', 'shopping-bag',    true, 7),
    (p_user_id, 'Educación',       'expense', '#14b8a6', 'book-open',       true, 8),
    (p_user_id, 'Viajes',          'expense', '#06b6d4', 'airplane',        true, 9),
    (p_user_id, 'Otros gastos',    'expense', '#64748b', 'dots-three',      true, 99),
    (p_user_id, 'Salario',         'income',  '#22c55e', 'briefcase',       true, 1),
    (p_user_id, 'Freelance',       'income',  '#84cc16', 'laptop',          true, 2),
    (p_user_id, 'Inversiones',     'income',  '#0ea5e9', 'trend-up',        true, 3),
    (p_user_id, 'Otros ingresos',  'income',  '#64748b', 'dots-three',      true, 99);
end;
$$;

create or replace function handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into profiles (id) values (new.id);
  perform seed_default_categories(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
