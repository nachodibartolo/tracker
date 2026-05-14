"use server";

// Server actions for the Telegram linking flow.
//
// `generateLinkCode` is invoked from the settings page when the user wants to
// pair a Telegram account. It writes a single-use 6-digit OTP into
// `telegram_link_codes` with a 10-minute TTL. The bot consumes it from inside
// `/start <code>` (see `lib/telegram/handlers/start.ts`).
//
// `revokeTelegramLink` deletes the user's `telegram_users` row so the same
// chat-id is no longer trusted. The user can re-link by generating a new code.

import { randomInt } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface LinkCodeData {
  code: string;
  expiresAt: string;
}

export async function generateLinkCode(): Promise<ActionResult<LinkCodeData>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      ok: false,
      error: "Telegram no está configurado todavía",
    };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Configuración inválida",
    };
  }

  // Clear any prior unconsumed codes for this user so the new code is the
  // only one that works. We can't `upsert` because `telegram_link_codes` is
  // keyed by code (the OTP) — not by user_id.
  const { error: deleteErr } = await admin
    .from("telegram_link_codes")
    .delete()
    .eq("user_id", user.id);
  if (deleteErr) {
    console.error("[telegram/generateLinkCode] cleanup failed", deleteErr);
  }

  // 6-digit numeric code (000000 – 999999), cryptographically random. The
  // PK is `char(6)`, so we zero-pad. Retry once if we collide (vanishingly
  // unlikely at our scale, but cheap insurance).
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    const { error: insertErr } = await admin
      .from("telegram_link_codes")
      .insert({
        code,
        user_id: user.id,
        expires_at: expiresAt,
      });

    if (!insertErr) {
      return { ok: true, data: { code, expiresAt } };
    }

    // Postgres unique-violation = collision on the PK; loop again. Anything
    // else is fatal.
    if (insertErr.code !== "23505") {
      return {
        ok: false,
        error: insertErr.message ?? "No se pudo generar el código",
      };
    }
  }

  return { ok: false, error: "No se pudo generar el código" };
}

export async function revokeTelegramLink(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      ok: false,
      error: "Telegram no está configurado todavía",
    };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Configuración inválida",
    };
  }

  const { error } = await admin
    .from("telegram_users")
    .delete()
    .eq("user_id", user.id);
  if (error) {
    return {
      ok: false,
      error: error.message ?? "No se pudo desvincular",
    };
  }

  // Also wipe any outstanding codes so an old code can't relink.
  await admin
    .from("telegram_link_codes")
    .delete()
    .eq("user_id", user.id);

  revalidatePath("/settings");
  revalidatePath("/settings/telegram");
  return { ok: true };
}
