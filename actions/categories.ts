"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CATEGORY_ICON_NAMES } from "@/lib/category-icons";
import {
  getFlatCategoryOptions,
  type FlatCategoryOption,
} from "@/lib/domain/categories";
import { createClient } from "@/lib/supabase/server";
import type { CategoryUpdate } from "@/lib/supabase/database.types";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// We accept any hex color, but ensure it's a valid #rrggbb form. The picker
// constrains to PALETTE, but allowing arbitrary hex keeps the API flexible
// and forward-compatible with future custom-color UI.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const baseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(40, "Máximo 40 caracteres"),
  type: z.enum(["expense", "income"], {
    message: "Tipo inválido",
  }),
  parent_id: z
    .string()
    .uuid("Categoría padre inválida")
    .nullable()
    .optional(),
  color: z
    .string()
    .regex(HEX_COLOR, "Color inválido"),
  icon: z
    .string()
    .min(1, "Ícono inválido")
    .refine((v) => CATEGORY_ICON_NAMES.includes(v), {
      message: "Ícono inválido",
    }),
});

const createSchema = baseSchema;

const updateSchema = baseSchema.partial();

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null as null };
  }
  return { supabase, user };
}

export async function createCategory(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  const { name, type, parent_id, color, icon } = parsed.data;

  // If parent_id is supplied, validate it belongs to the user, has the same
  // type, and is top-level (no nested-grandchildren allowed).
  if (parent_id) {
    const { data: parent, error: parentErr } = await supabase
      .from("categories")
      .select("id, user_id, type, parent_id")
      .eq("id", parent_id)
      .maybeSingle();
    if (parentErr || !parent) {
      return { ok: false, error: "Categoría padre no encontrada" };
    }
    if (parent.user_id !== user.id) {
      return { ok: false, error: "No autorizado" };
    }
    if (parent.type !== type) {
      return { ok: false, error: "La categoría padre es de otro tipo" };
    }
    if (parent.parent_id !== null) {
      return {
        ok: false,
        error: "No se permiten más de 2 niveles de categorías",
      };
    }
  }

  // Compute position as max(position)+1 among siblings (same user, same type,
  // same parent_id slot — null vs uuid).
  let siblingsQuery = supabase
    .from("categories")
    .select("position")
    .eq("user_id", user.id)
    .eq("type", type);

  siblingsQuery = parent_id
    ? siblingsQuery.eq("parent_id", parent_id)
    : siblingsQuery.is("parent_id", null);

  const { data: maxRow } = await siblingsQuery
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxRow?.position ?? -1) + 1;

  const { data: inserted, error: insertErr } = await supabase
    .from("categories")
    .insert({
      user_id: user.id,
      name,
      type,
      parent_id: parent_id ?? null,
      color,
      icon,
      position,
      is_system: false,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: insertErr?.message ?? "No se pudo crear la categoría",
    };
  }

  revalidatePath("/categories");
  return { ok: true, data: { id: inserted.id } };
}

export async function updateCategory(
  id: string,
  patch: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  if (!id || typeof id !== "string") {
    return { ok: false, error: "Id inválido" };
  }
  const parsed = updateSchema.safeParse(patch);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  // Ownership check + load current row to validate parent rules.
  const { data: current, error: loadErr } = await supabase
    .from("categories")
    .select("id, user_id, type, parent_id")
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !current) {
    return { ok: false, error: "Categoría no encontrada" };
  }
  if (current.user_id !== user.id) {
    return { ok: false, error: "No autorizado" };
  }

  const nextType = parsed.data.type ?? current.type;

  if (parsed.data.parent_id !== undefined) {
    const newParent = parsed.data.parent_id;
    if (newParent) {
      if (newParent === id) {
        return { ok: false, error: "Una categoría no puede ser su propio padre" };
      }
      const { data: parent, error: parentErr } = await supabase
        .from("categories")
        .select("id, user_id, type, parent_id")
        .eq("id", newParent)
        .maybeSingle();
      if (parentErr || !parent) {
        return { ok: false, error: "Categoría padre no encontrada" };
      }
      if (parent.user_id !== user.id) {
        return { ok: false, error: "No autorizado" };
      }
      if (parent.type !== nextType) {
        return { ok: false, error: "La categoría padre es de otro tipo" };
      }
      if (parent.parent_id !== null) {
        return {
          ok: false,
          error: "No se permiten más de 2 niveles de categorías",
        };
      }
    }
  }

  const update: CategoryUpdate = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.type !== undefined) update.type = parsed.data.type;
  if (parsed.data.parent_id !== undefined) update.parent_id = parsed.data.parent_id;
  if (parsed.data.color !== undefined) update.color = parsed.data.color;
  if (parsed.data.icon !== undefined) update.icon = parsed.data.icon;

  if (Object.keys(update).length === 0) {
    return { ok: true };
  }

  const { error: updateErr } = await supabase
    .from("categories")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateErr) {
    return {
      ok: false,
      error: updateErr.message ?? "No se pudo actualizar la categoría",
    };
  }

  revalidatePath("/categories");
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  if (!id || typeof id !== "string") {
    return { ok: false, error: "Id inválido" };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  const { data: current, error: loadErr } = await supabase
    .from("categories")
    .select("id, user_id, is_system")
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !current) {
    return { ok: false, error: "Categoría no encontrada" };
  }
  if (current.user_id !== user.id) {
    return { ok: false, error: "No autorizado" };
  }
  if (current.is_system) {
    return {
      ok: false,
      error: "No podés eliminar una categoría del sistema",
    };
  }

  // Subcategories cascade via FK on parent_id (on delete cascade) in 0001_init.
  const { error: deleteErr } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteErr) {
    return {
      ok: false,
      error: deleteErr.message ?? "No se pudo eliminar la categoría",
    };
  }

  revalidatePath("/categories");
  return { ok: true };
}

/**
 * Devuelve las categorías del usuario actual para un tipo dado, en formato
 * plano (top-level + subcategorías con prefijo `"Parent › Child"`). Pensada
 * para selects on-demand desde componentes cliente — la página de transacciones
 * ya las fetchea server-side, así que esta acción cubre los lugares donde no
 * tenemos la lista pre-cargada (dashboard, recent-transactions).
 */
export async function getMyCategoryOptions(
  type: "expense" | "income",
): Promise<ActionResult<FlatCategoryOption[]>> {
  if (type !== "expense" && type !== "income") {
    return { ok: false, error: "Tipo inválido" };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  try {
    const options = await getFlatCategoryOptions(supabase, user.id, type);
    return { ok: true, data: options };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudieron cargar las categorías";
    return { ok: false, error: message };
  }
}

