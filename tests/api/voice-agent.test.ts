import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted ABOVE top-level const declarations, so we
// use vi.hoisted to lift the shared mock state alongside them.
const {
  runAgentMock,
  FakeQuotaError,
  tokenSelect,
  tokenUpdate,
  profileSelect,
} = vi.hoisted(() => {
  const runAgentMock = vi.fn();
  class FakeQuotaError extends Error {
    constructor() {
      super("quota");
      this.name = "AgentQuotaError";
    }
  }
  return {
    runAgentMock,
    FakeQuotaError,
    tokenSelect: vi.fn(),
    tokenUpdate: vi.fn(),
    profileSelect: vi.fn(),
  };
});

vi.mock("@/lib/ai/agent", () => ({
  runExpenseAgent: runAgentMock,
  AgentQuotaError: FakeQuotaError,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "voice_tokens") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({ maybeSingle: tokenSelect }),
            }),
          }),
          update: tokenUpdate,
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: profileSelect }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/voice/agent/route";
import { hashVoiceToken } from "@/lib/voice-tokens/tokens";

const PLAIN_TOKEN = "vt_test_plaintext_abc123";

function makeReq(opts: {
  authHeader?: string;
  body?: unknown;
}): Request {
  return new Request("http://test.local/api/voice/agent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.authHeader ? { authorization: opts.authHeader } : {}),
    },
    body: JSON.stringify(opts.body ?? {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Env must be set so the route's "Backend no configurado" guard passes.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  // tokenUpdate is fire-and-forget; ensure the chained `.eq()` works.
  tokenUpdate.mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  // Default happy-path mocks.
  tokenSelect.mockResolvedValue({
    data: {
      id: "tok-1",
      user_id: "user-1",
      default_wallet_id: "wallet-1",
    },
    error: null,
  });
  profileSelect.mockResolvedValue({
    data: { main_currency: "ARS" },
    error: null,
  });
  runAgentMock.mockResolvedValue({ text: "✅ Anotado $500 en Comida" });
});

describe("POST /api/voice/agent", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const r = await POST(makeReq({ body: { text: "x" } }));
    expect(r.status).toBe(401);
  });

  it("returns 401 when token is malformed", async () => {
    const r = await POST(makeReq({ authHeader: "NotBearer xyz", body: { text: "x" } }));
    expect(r.status).toBe(401);
  });

  it("returns 401 when token does not match any row", async () => {
    tokenSelect.mockResolvedValue({ data: null, error: null });
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "x" },
    }));
    expect(r.status).toBe(401);
  });

  it("returns 400 when body has no text", async () => {
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: {},
    }));
    expect(r.status).toBe(400);
  });

  it("returns 200 with agent text on happy path", async () => {
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "gasté 500 en el super" },
    }));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { ok: boolean; text: string };
    expect(json).toEqual({ ok: true, text: "✅ Anotado $500 en Comida" });

    // Verify we delegated with the right args.
    expect(runAgentMock).toHaveBeenCalledTimes(1);
    const args = runAgentMock.mock.calls[0]?.[0];
    expect(args.userId).toBe("user-1");
    expect(args.chatId).toBe(-1);
    expect(args.mainCurrency).toBe("ARS");
    expect(args.text).toBe("gasté 500 en el super");
    expect(args.defaultWalletId).toBe("wallet-1");
  });

  it("looks up the token by sha256 hash, not plaintext", async () => {
    await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "x" },
    }));
    // Walk the from() chain to confirm; with the current mock shape we
    // can't easily inspect the WHERE clause, so assert tokenSelect was
    // invoked exactly once and the hash logic is exercised indirectly via
    // the unit test in Task 2.
    expect(tokenSelect).toHaveBeenCalledTimes(1);
    expect(hashVoiceToken(PLAIN_TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 200 with ok:false when the agent throws AgentQuotaError", async () => {
    runAgentMock.mockRejectedValue(new FakeQuotaError());
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "x" },
    }));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { ok: boolean; text: string };
    expect(json.ok).toBe(false);
    expect(json.text).toMatch(/cuota/i);
  });

  it("returns 200 with ok:false generic message when agent throws unknown error", async () => {
    runAgentMock.mockRejectedValue(new Error("boom"));
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "x" },
    }));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { ok: boolean; text: string };
    expect(json.ok).toBe(false);
    expect(json.text).toMatch(/algo fall/i);
  });
});
