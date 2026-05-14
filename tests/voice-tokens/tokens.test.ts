import { describe, expect, it } from "vitest";

import { generateVoiceToken, hashVoiceToken } from "@/lib/voice-tokens/tokens";

describe("voice token helpers", () => {
  it("generateVoiceToken returns a vt_-prefixed token of >=40 chars", () => {
    const t = generateVoiceToken();
    expect(t.startsWith("vt_")).toBe(true);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it("generateVoiceToken returns a unique token each call", () => {
    const a = generateVoiceToken();
    const b = generateVoiceToken();
    expect(a).not.toBe(b);
  });

  it("hashVoiceToken returns a deterministic 64-char hex string", () => {
    const t = "vt_abc123";
    const h1 = hashVoiceToken(t);
    const h2 = hashVoiceToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashVoiceToken differs for different inputs", () => {
    expect(hashVoiceToken("vt_a")).not.toBe(hashVoiceToken("vt_b"));
  });
});
