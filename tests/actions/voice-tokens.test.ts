import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the server-side supabase clients BEFORE importing the actions module.
const adminInsert = vi.fn();
const adminUpdate = vi.fn();
const adminSelect = vi.fn();
const adminFromMock = vi.fn();

const mockUser = { id: "user-uuid-1" };
type SessionUser = { id: string } | null;
const sessionGetUser = vi.fn(
  async (): Promise<{ data: { user: SessionUser } }> => ({
    data: { user: mockUser },
  }),
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: sessionGetUser },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: adminFromMock,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createVoiceToken,
  revokeVoiceToken,
} from "@/actions/voice-tokens";
import { hashVoiceToken } from "@/lib/voice-tokens/tokens";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: env wired, admin client succeeds.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

  adminFromMock.mockImplementation((table: string) => {
    if (table !== "voice_tokens") throw new Error(`unexpected table ${table}`);
    return {
      // Mirrors `.insert(row).select(...).single()` from the impl.
      insert: (...args: unknown[]) => ({
        select: () => ({
          single: () =>
            adminInsert(...args).then(() => ({
              data: { id: "tok-1", label: (args[0] as { label: string }).label },
              error: null,
            })),
        }),
      }),
      // Mirrors `.update(patch).eq("id", id).eq("user_id", uid)`.
      update: (...args: unknown[]) => ({
        eq: () => ({
          eq: () => adminUpdate(...args).then(() => ({ error: null })),
        }),
      }),
      select: (...args: unknown[]) => adminSelect(...args),
    };
  });
  sessionGetUser.mockResolvedValue({ data: { user: mockUser } });
});

describe("createVoiceToken", () => {
  it("rejects when there is no session", async () => {
    sessionGetUser.mockResolvedValue({ data: { user: null } });
    const r = await createVoiceToken({ label: "iPhone", default_wallet_id: null });
    expect(r.ok).toBe(false);
  });

  it("stores the sha256 hash and never the plaintext", async () => {
    adminInsert.mockResolvedValue({ error: null });
    const r = await createVoiceToken({ label: "iPhone", default_wallet_id: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const plaintext = r.data!.token;
    expect(plaintext.startsWith("vt_")).toBe(true);
    const inserted = adminInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.token_hash).toBe(hashVoiceToken(plaintext));
    expect(JSON.stringify(inserted)).not.toContain(plaintext);
  });
});

describe("revokeVoiceToken", () => {
  it("sets revoked_at to a timestamp, scoped to the caller user_id", async () => {
    adminUpdate.mockResolvedValue({ error: null });
    const r = await revokeVoiceToken("token-id-1");
    expect(r.ok).toBe(true);
    const patch = adminUpdate.mock.calls[0]?.[0] as { revoked_at: string };
    expect(patch.revoked_at).toBeTruthy();
    expect(() => new Date(patch.revoked_at).toISOString()).not.toThrow();
  });

  it("rejects when there is no session", async () => {
    sessionGetUser.mockResolvedValue({ data: { user: null } });
    const r = await revokeVoiceToken("token-id-1");
    expect(r.ok).toBe(false);
  });
});
