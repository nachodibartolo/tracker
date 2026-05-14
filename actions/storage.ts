"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const BUCKET = "receipts";

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const SIGNED_URL_TTL_SECONDS = 60 * 5; // 5 minutes

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  return { supabase, userId: user.id };
}

function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: string }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return fallback;
}

/**
 * Upload a receipt photo to private storage. The file is read from `FormData`
 * (the client passes a freshly-compressed Blob/File under the `file` key).
 *
 * Validation:
 * - MIME must be one of jpeg | png | webp
 * - Size ≤ 5 MB (already enforced by the client compressor; this is the
 *   server's safety net)
 *
 * The path layout — `<auth.uid()>/<uuid>.<ext>` — matches the bucket RLS in
 * migration `0003_storage.sql`, which keys access on `storage.foldername(name)[1]`.
 * We use the user-scoped server client (not admin) so RLS enforces ownership
 * end-to-end; if the wrong user reaches this code, the insert just fails.
 */
export async function uploadReceiptPhoto(
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const raw = formData.get("file");
  if (!raw || !(raw instanceof File)) {
    return { ok: false, error: "Archivo inválido" };
  }
  const file = raw;

  const extension = ALLOWED_MIME[file.type];
  if (!extension) {
    return {
      ok: false,
      error: "Formato no permitido (usá JPG, PNG o WebP)",
    };
  }
  if (file.size <= 0) {
    return { ok: false, error: "Archivo vacío" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "El archivo supera 5 MB" };
  }

  const { supabase, userId } = await requireUser();
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;

  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      return { ok: false, error: describeError(error, "No se pudo subir la foto") };
    }
    return { ok: true, data: { path } };
  } catch (err) {
    return { ok: false, error: describeError(err, "No se pudo subir la foto") };
  }
}

/**
 * Issue a short-lived signed URL for a receipt object. RLS guarantees the
 * user can only sign their own paths; this is enforced by the bucket policy,
 * not application logic.
 */
export async function getReceiptSignedUrl(
  path: string,
): Promise<ActionResult<{ url: string }>> {
  if (!path || typeof path !== "string") {
    return { ok: false, error: "Ruta inválida" };
  }
  const { supabase } = await requireUser();

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      return {
        ok: false,
        error: describeError(error, "No se pudo generar el enlace"),
      };
    }
    return { ok: true, data: { url: data.signedUrl } };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo generar el enlace"),
    };
  }
}

/**
 * Delete a receipt object. Safe to call with a path that doesn't exist —
 * supabase-js returns success when the object is already gone.
 */
export async function deleteReceiptPhoto(path: string): Promise<ActionResult> {
  if (!path || typeof path !== "string") {
    return { ok: false, error: "Ruta inválida" };
  }
  const { supabase } = await requireUser();

  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) {
      return {
        ok: false,
        error: describeError(error, "No se pudo eliminar la foto"),
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo eliminar la foto"),
    };
  }
}
