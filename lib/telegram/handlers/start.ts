// /start handler — onboarding + link-code consumption.
//
// Flow:
//   /start              → onboarding text pointing the user at the web app
//   /start <6-digit>    → look up `telegram_link_codes`, upsert
//                         `telegram_users`, DELETE the consumed code, reply
//                         with a friendly success message addressing the
//                         linked account.
//
// The webhook's secret-token check is the only gate that authenticates the
// caller as "Telegram". From there we trust `ctx.from.id` (Telegram's numeric
// user id) and the 6-digit code that the human pasted from the web app.

import type { Bot, CommandContext, Context } from "grammy";

import { createAdminClient } from "@/lib/supabase/admin";

const ONBOARDING_TEXT =
  "Hola! Soy el bot de Tracker. Para empezar, andá a la app, generá un código en Ajustes → Telegram y mandámelo con `/start <codigo>`.";

const SIX_DIGIT_RE = /^\d{6}$/;

export function registerStartHandler(bot: Bot): void {
  bot.command("start", handleStart);
}

async function handleStart(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from;
  if (!from) {
    // /start in a channel post or some other contextless update — nothing
    // useful we can do without a numeric user id.
    return;
  }

  const arg = (ctx.match ?? "").trim();
  if (!arg) {
    await ctx.reply(ONBOARDING_TEXT, { parse_mode: "Markdown" });
    return;
  }

  const code = arg.replace(/\D/g, "").slice(0, 6);
  if (!SIX_DIGIT_RE.test(code)) {
    await ctx.reply("Código inválido o vencido.");
    return;
  }

  // Pre-provisioning safety: admin client init would throw without env.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    await ctx.reply("Código inválido o vencido.");
    return;
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    await ctx.reply("Código inválido o vencido.");
    return;
  }

  // Look up an unexpired code. We compare `expires_at > now()` server-side so
  // clock skew between the bot host and Postgres doesn't matter.
  const nowIso = new Date().toISOString();
  const { data: codeRow, error: codeError } = await supabase
    .from("telegram_link_codes")
    .select("code, user_id, expires_at")
    .eq("code", code)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (codeError || !codeRow) {
    await ctx.reply("Código inválido o vencido.");
    return;
  }

  const username = from.username ?? null;

  // Upsert on the primary key (user_id) so re-linking the same Telegram
  // account or switching to a different one both Just Work.
  const { error: upsertError } = await supabase
    .from("telegram_users")
    .upsert(
      {
        user_id: codeRow.user_id,
        telegram_user_id: from.id,
        telegram_username: username,
      },
      { onConflict: "user_id" },
    );

  if (upsertError) {
    console.error("[telegram/start] upsert failed", upsertError);
    await ctx.reply("Algo falló. Probá generar otro código.");
    return;
  }

  // Consume the code so it can't be reused. Done AFTER the upsert so a
  // transient failure on the link table doesn't burn the user's code.
  await supabase.from("telegram_link_codes").delete().eq("code", codeRow.code);

  // Best-effort: fetch the email to make the confirmation friendlier.
  let label = username ? `@${username}` : "tu cuenta";
  try {
    const { data: userResp } = await supabase.auth.admin.getUserById(
      codeRow.user_id,
    );
    const email = userResp?.user?.email ?? null;
    if (!username && email) {
      label = email;
    }
  } catch {
    // Leave default label.
  }

  await ctx.reply(`✅ Listo, vinculado al usuario ${label}.`);
}
