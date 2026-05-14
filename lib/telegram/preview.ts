// Render the confirmation preview that the bot replies with after running
// the AI extractor. The preview shows every field we plan to persist so the
// user can sanity-check the model's output before tapping "Confirmar".
//
// We use MarkdownV2 because it gives us monospaced amounts and bold field
// names; the trade-off is every Telegram-reserved character has to be
// escaped or the API rejects the whole message. We re-use the `escapeMd`
// helper from `handlers/status.ts` so the escape set stays consistent
// across handlers.

import type { ExpenseExtraction } from "@/lib/ai/schemas";
import { formatCurrency, formatDate } from "@/lib/format";
import type { TxSource } from "@/lib/supabase/database.types";

import { escapeMd } from "./handlers/status";

export interface PreviewResult {
  text: string;
  /** Parse mode tag callers should pass to `ctx.reply(..., { parse_mode })`. */
  markdown: "MarkdownV2";
}

function typeLabel(t: ExpenseExtraction["type"]): string {
  if (t === "expense") return "gasto";
  if (t === "income") return "ingreso";
  return "desconocido";
}

function sourceLabel(s: TxSource): string {
  switch (s) {
    case "telegram_text":
      return "texto";
    case "telegram_photo":
      return "foto";
    case "telegram_audio":
      return "audio";
    case "manual":
    default:
      return "manual";
  }
}

/**
 * Render a confidence percentage (0–1 → 0–100%). Negative or non-finite
 * values collapse to 0 so the message never shows NaN.
 */
function confidencePct(c: number): string {
  if (!Number.isFinite(c) || c < 0) return "0%";
  const pct = Math.round(Math.min(1, c) * 100);
  return `${pct}%`;
}

/**
 * Build the user-visible preview text + parse_mode tag. The inline keyboard
 * is the caller's responsibility because it embeds the `pending_id`.
 */
export function buildPreview(
  extraction: ExpenseExtraction,
  walletName: string,
  walletCurrency: string,
  categoryLabel: string,
  photo: boolean | undefined,
  source: TxSource,
): PreviewResult {
  const lines: string[] = [];
  lines.push("✏️ *Revisá lo que entendí:*");

  // Type (+ which input modality the AI used) ------------------------------
  lines.push(
    `• *Tipo:* ${escapeMd(typeLabel(extraction.type))} ${escapeMd(`(${sourceLabel(source)})`)}`,
  );

  // Amount + currency ------------------------------------------------------
  const amountCurrency = extraction.currency ?? walletCurrency.toUpperCase();
  const amountStr =
    extraction.amount !== null && Number.isFinite(extraction.amount)
      ? formatCurrency(extraction.amount, amountCurrency)
      : "?";
  lines.push(`• *Monto:* \`${escapeMd(amountStr)}\``);

  // Wallet -----------------------------------------------------------------
  lines.push(`• *Wallet:* ${escapeMd(walletName)}`);

  // Category ---------------------------------------------------------------
  lines.push(`• *Categoría:* ${escapeMd(categoryLabel)}`);

  // Date -------------------------------------------------------------------
  const dateLabel = extraction.occurred_at
    ? formatDate(extraction.occurred_at, "PPP")
    : "hoy";
  lines.push(`• *Fecha:* ${escapeMd(dateLabel)}`);

  // Payee + description (only when non-empty) ------------------------------
  if (extraction.payee) {
    lines.push(`• *Lugar:* ${escapeMd(extraction.payee)}`);
  }
  if (extraction.description) {
    lines.push(`• *Descripción:* ${escapeMd(extraction.description)}`);
  }

  // Photo hint (only when the photo flow attached one) ---------------------
  if (photo) {
    lines.push("• *Foto:* adjunta");
  }

  // Confidence -------------------------------------------------------------
  lines.push(
    `• *Confianza:* ${escapeMd(confidencePct(extraction.confidence))}`,
  );

  return {
    text: lines.join("\n"),
    markdown: "MarkdownV2",
  };
}
