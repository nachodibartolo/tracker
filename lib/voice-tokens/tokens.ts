import { createHash, randomBytes } from "node:crypto";

const PREFIX = "vt_";

/**
 * Returns a plaintext voice-token of the form `vt_<43 base64url chars>`
 * (32 bytes of cryptographic randomness, base64url-encoded). The plaintext
 * is shown to the user ONCE; we persist only the sha256 hex hash.
 */
export function generateVoiceToken(): string {
  const raw = randomBytes(32).toString("base64url");
  return `${PREFIX}${raw}`;
}

/**
 * Returns the lowercase hex sha256 of `token` (64 chars). Used both at
 * creation time (to compute the value stored in `voice_tokens.token_hash`)
 * and at request time (to look up the token without ever persisting the
 * plaintext).
 */
export function hashVoiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
