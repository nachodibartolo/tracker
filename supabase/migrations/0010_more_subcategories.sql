-- Seed sub-categories under every default top-level category. "Comida"
-- already got its 5 sub-cats in 0009; this migration adds sub-cats for the
-- remaining parents (Transporte, Servicios, Hogar, Salud, Entretenimiento,
-- Compras, Educación, Viajes, Salario, Freelance, Inversiones).
--
-- "Otros gastos" / "Otros ingresos" intentionally stay leaf-only — they're
-- the catch-all buckets.
--
-- The seed function is restructured to delegate sub-category insertion to a
-- single helper (_seed_category_children) so future adjustments live in one
-- place. Backfill for existing users reuses the same helper.

create or replace function _seed_category_children(
  p_user_id uuid,
  p_parent_name text,
  p_type category_type,
  p_subs jsonb
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_parent_id uuid;
  v_parent_color text;
begin
  -- Find the top-level parent by name + type. If the user is missing it
  -- (e.g. they deleted the system row), silently skip — we don't want a
  -- backfill to recreate categories the user explicitly removed.
  select id, color into v_parent_id, v_parent_color
    from categories
    where user_id = p_user_id
      and name = p_parent_name
      and parent_id is null
      and type = p_type
    limit 1;

  if v_parent_id is null then
    return;
  end if;

  -- Insert sub-cats with NOT EXISTS guard on (parent_id, name) so re-running
  -- this is idempotent. Sub-cat color inherits the parent's color so the
  -- swatch palette stays coherent in the UI.
  insert into categories (
    user_id, name, type, parent_id, color, icon, is_system, position
  )
  select
    p_user_id,
    (s->>'name')::text,
    p_type,
    v_parent_id,
    v_parent_color,
    (s->>'icon')::text,
    true,
    (s->>'position')::int
  from jsonb_array_elements(p_subs) as s
  where not exists (
    select 1 from categories c
    where c.user_id = p_user_id
      and c.parent_id = v_parent_id
      and c.name = (s->>'name')::text
  );
end;
$$;

-- Single source of truth for the default sub-category list. Called from
-- seed_default_categories (new users) and the backfill block below
-- (existing users).
create or replace function _seed_default_subcategories(p_user_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  perform _seed_category_children(p_user_id, 'Comida', 'expense', $j$[
    {"name": "Comida rápida", "icon": "hamburger",     "position": 1},
    {"name": "Kiosco",        "icon": "storefront",    "position": 2},
    {"name": "Bar",           "icon": "beer-stein",    "position": 3},
    {"name": "Café",          "icon": "coffee",        "position": 4},
    {"name": "Supermercado",  "icon": "shopping-cart", "position": 5}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Transporte', 'expense', $j$[
    {"name": "Combustible",     "icon": "gas-pump", "position": 1},
    {"name": "Estacionamiento", "icon": "car",      "position": 2},
    {"name": "Peaje",           "icon": "ticket",   "position": 3},
    {"name": "Taxi/Uber",       "icon": "taxi",     "position": 4},
    {"name": "SUBE/Público",    "icon": "bus",      "position": 5}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Servicios', 'expense', $j$[
    {"name": "Luz",      "icon": "lightbulb",     "position": 1},
    {"name": "Gas",      "icon": "flame",         "position": 2},
    {"name": "Agua",     "icon": "drop",          "position": 3},
    {"name": "Internet", "icon": "wifi-high",     "position": 4},
    {"name": "Celular",  "icon": "device-mobile", "position": 5}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Hogar', 'expense', $j$[
    {"name": "Alquiler",     "icon": "key",       "position": 1},
    {"name": "Expensas",     "icon": "buildings", "position": 2},
    {"name": "Limpieza",     "icon": "sparkle",   "position": 3},
    {"name": "Reparaciones", "icon": "wrench",    "position": 4}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Salud', 'expense', $j$[
    {"name": "Farmacia",    "icon": "pill",        "position": 1},
    {"name": "Médico",      "icon": "stethoscope", "position": 2},
    {"name": "Obra social", "icon": "first-aid",   "position": 3},
    {"name": "Gimnasio",    "icon": "barbell",     "position": 4}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Entretenimiento', 'expense', $j$[
    {"name": "Cine",      "icon": "film-strip",  "position": 1},
    {"name": "Recitales", "icon": "music-notes", "position": 2},
    {"name": "Salidas",   "icon": "users",       "position": 3},
    {"name": "Streaming", "icon": "television",  "position": 4}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Compras', 'expense', $j$[
    {"name": "Ropa",        "icon": "t-shirt", "position": 1},
    {"name": "Calzado",     "icon": "sneaker", "position": 2},
    {"name": "Electrónica", "icon": "laptop",  "position": 3},
    {"name": "Regalos",     "icon": "gift",    "position": 4}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Educación', 'expense', $j$[
    {"name": "Cursos",     "icon": "graduation-cap", "position": 1},
    {"name": "Libros",     "icon": "book-open",      "position": 2},
    {"name": "Materiales", "icon": "folder",         "position": 3}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Viajes', 'expense', $j$[
    {"name": "Pasajes",          "icon": "airplane",   "position": 1},
    {"name": "Alojamiento",      "icon": "bed",        "position": 2},
    {"name": "Actividades",      "icon": "camera",     "position": 3},
    {"name": "Comida en viajes", "icon": "fork-knife", "position": 4}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Salario', 'income', $j$[
    {"name": "Sueldo",    "icon": "money-wavy", "position": 1},
    {"name": "Aguinaldo", "icon": "gift",       "position": 2},
    {"name": "Bonus",     "icon": "coin",       "position": 3}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Freelance', 'income', $j$[
    {"name": "Proyectos",   "icon": "briefcase",  "position": 1},
    {"name": "Consultoría", "icon": "chart-line", "position": 2}
  ]$j$::jsonb);

  perform _seed_category_children(p_user_id, 'Inversiones', 'income', $j$[
    {"name": "Dividendos", "icon": "coin-vertical", "position": 1},
    {"name": "Intereses",  "icon": "piggy-bank",    "position": 2},
    {"name": "Ventas",     "icon": "trend-up",      "position": 3}
  ]$j$::jsonb);
end;
$$;

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

  perform _seed_default_subcategories(p_user_id);
end;
$$;

-- Backfill every existing user. Runs only the sub-category seed (not the
-- top-level INSERT) so we never duplicate the parents.
do $$
declare
  u record;
begin
  for u in select id from auth.users loop
    perform _seed_default_subcategories(u.id);
  end loop;
end $$;
