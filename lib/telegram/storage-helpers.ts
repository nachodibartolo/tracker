// Shared helpers for fetching Telegram-hosted files and persisting them into
// Supabase Storage. Used by the photo and voice handlers.
//
// Telegram files live at `https://api.telegram.org/file/bot<TOKEN>/<path>`
// with a 1-hour-ish TTL. We fetch them once, hand the bytes to the AI core
// for extraction, and (for photos) upload them to our private `receipts`
// bucket so we can render them next to the transaction later. Voice notes
// are NOT persisted in Wave 4C — they're only used at extraction time.
//
// Path layout `<user_id>/<uuid>.<ext>` matches the bucket RLS in
// `supabase/migrations/0003_storage.sql` (which keys on
// `storage.foldername(name)[1]`). We use the admin client so the upload
// bypasses RLS, but the path itself stays user-scoped so the regular web
// client can read the receipt back when the user views the transaction.

import { createAdminClient } from "@/lib/supabase/admin";

const RECEIPTS_BUCKET = "receipts";

/**
 * Fetch a Telegram-hosted file by its `file_path` (from
 * `bot.api.getFile(fileId)`) and return the raw bytes. Throws if the bot
 * token is missing or Telegram returns a non-2xx — callers are expected to
 * catch and degrade gracefully.
 */
export async function fetchTelegramFile(
  filePath: string,
): Promise<Uint8Array> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN missing");
  }
  // `file_path` is server-controlled (we got it from getFile), so we don't
  // need to URL-encode it; Telegram already gives us a safe relative path.
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Telegram file fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Upload arbitrary bytes to the `receipts` bucket under
 * `<userId>/<uuid>.<ext>` and return the stored path. Throws if the admin
 * client isn't configured or the upload fails.
 */
export async function uploadReceiptToStorage(
  userId: string,
  bytes: Uint8Array,
  ext: string = "jpg",
): Promise<string> {
  const supabase = createAdminClient();
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  // Map common image extensions back to a sensible Content-Type so signed
  // URLs render natively in the browser. We default to image/jpeg because
  // Telegram pre-processes photos to JPEG before exposing them via getFile.
  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";

  const { error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, bytes, {
      contentType,
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error(
      `Receipt upload failed: ${error.message ?? "unknown error"}`,
    );
  }
  return path;
}
