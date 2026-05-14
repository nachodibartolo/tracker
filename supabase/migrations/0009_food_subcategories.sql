-- Seed default sub-categories under "Comida" for new + existing users.
--
-- The base seed (0004) inserts top-level "Comida". This migration extends the
-- seed function so newly-created users get the 5 sub-categories on signup,
-- AND backfills the same rows for any existing user that already has a
-- top-level "Comida" with no children.

create or replace function seed_default_categories(p_user_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_comida_id uuid;
begin
  -- Top-level categories
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

  select id into v_comida_id
    from categories
    where user_id = p_user_id and name = 'Comida' and type = 'expense' and parent_id is null
    limit 1;

  if v_comida_id is not null then
    insert into categories (user_id, name, type, parent_id, color, icon, is_system, position) values
      (p_user_id, 'Comida rápida', 'expense', v_comida_id, '#ef4444', 'hamburger',    true, 1),
      (p_user_id, 'Kiosco',        'expense', v_comida_id, '#ef4444', 'storefront',   true, 2),
      (p_user_id, 'Bar',           'expense', v_comida_id, '#ef4444', 'beer-stein',   true, 3),
      (p_user_id, 'Café',          'expense', v_comida_id, '#ef4444', 'coffee',       true, 4),
      (p_user_id, 'Supermercado',  'expense', v_comida_id, '#ef4444', 'shopping-cart',true, 5);
  end if;
end;
$$;

-- Backfill: every existing user that has a top-level Comida but no children
-- gets the 5 sub-categories. Idempotent via NOT EXISTS check on (parent_id,name).
do $$
declare
  r record;
begin
  for r in
    select id as parent_id, user_id
    from categories
    where name = 'Comida' and type = 'expense' and parent_id is null
  loop
    insert into categories (user_id, name, type, parent_id, color, icon, is_system, position)
    select r.user_id, sub.name, 'expense'::category_type, r.parent_id, '#ef4444', sub.icon, true, sub.position
    from (values
      ('Comida rápida', 'hamburger',     1),
      ('Kiosco',        'storefront',    2),
      ('Bar',           'beer-stein',    3),
      ('Café',          'coffee',        4),
      ('Supermercado',  'shopping-cart', 5)
    ) as sub(name, icon, position)
    where not exists (
      select 1 from categories c
      where c.user_id = r.user_id
        and c.parent_id = r.parent_id
        and c.name = sub.name
    );
  end loop;
end;
$$;
