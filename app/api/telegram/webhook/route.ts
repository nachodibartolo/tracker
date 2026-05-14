// Telegram webhook endpoint.
//
// Flow:
//   1. Validate the `X-Telegram-Bot-Api-Secret-Token` header up front. Saves
//      doing any work for forged requests.
//   2. Parse the body and pull `update_id`. Insert it into
//      `telegram_processed_updates`; a PK conflict means Telegram is retrying
//      a delivery we already accepted — in that case we return 200 and skip.
//      Telegram retries when it doesn't see a 2xx within ~10s, and the agent
//      can take much longer than that.
//   3. Return 200 immediately, then process the update via Next's `after()`.
//      That way Telegram's retry timer never fires while the agent is still
//      working, and grammY's default 10s `webhookCallback` timeout no longer
//      applies (we never use webhookCallback).
//
// Pre-provisioning safety: if the bot/Supabase env vars aren't wired yet
// (Wave 0–5 dev / CI), short-circuit with `{ok:true,skipped:true}` so cron
// pings stay green.

import { after } from "next/server";

import { bot, registerHandlers } from "@/lib/telegram/bot";
import { createAdminClient } from "@/lib/supabase/admin";

import type { Update } from "grammy/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// We return 200 within milliseconds; the agent finishes in `after()`. The
// runtime keeps the function alive until `after()` resolves, so this cap
// covers the slowest realistic agent run (Gemma free tier under rate limit).
export const maxDuration = 300;

registerHandlers();

export async function POST(req: Request): Promise<Response> {
  if (
    !process.env.TELEGRAM_BOT_TOKEN ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return Response.json({ ok: true, skipped: true });
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== expectedSecret) {
      return Response.json({ ok: false }, { status: 401 });
    }
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch (err) {
    console.error("[telegram/webhook] invalid json", err);
    return Response.json({ ok: false }, { status: 400 });
  }

  if (typeof update?.update_id !== "number") {
    return Response.json({ ok: false }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error: dedupErr } = await supabase
    .from("telegram_processed_updates")
    .insert({ update_id: update.update_id });

  if (dedupErr) {
    // 23505 = unique_violation = Telegram is retrying a delivery we already
    // accepted. Acknowledge with 200 so Telegram stops retrying.
    if (dedupErr.code === "23505") {
      console.info("[telegram/webhook] duplicate update", {
        update_id: update.update_id,
      });
      return Response.json({ ok: true, dedup: true });
    }
    // Any other dedup failure (DB outage, etc.): fail-open and process
    // anyway. Worst case the user sees the same reply twice; better than
    // silently dropping a real message.
    console.error("[telegram/webhook] dedup insert failed", dedupErr);
  }

  after(async () => {
    try {
      await bot.handleUpdate(update);
    } catch (err) {
      console.error("[telegram/webhook] handler error", err);
    }
  });

  return Response.json({ ok: true });
}
