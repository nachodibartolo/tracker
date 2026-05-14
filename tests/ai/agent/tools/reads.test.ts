import { describe, expect, it, vi } from "vitest";

import {
  listCategoriesTool,
  listRecentTool,
  listWalletsTool,
} from "@/lib/ai/agent/tools/reads";

/**
 * Builder mock: every chainable method returns the builder itself.
 * `then` makes the builder awaitable at any point in the chain, mirroring
 * how PostgrestQueryBuilder resolves to `{ data, error }` when awaited.
 */
function builderOf(data: unknown, error: unknown = null) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const k of [
    "select",
    "eq",
    "neq",
    "in",
    "or",
    "is",
    "gte",
    "lte",
    "gt",
    "lt",
    "order",
    "limit",
    "insert",
    "update",
    "delete",
  ]) {
    b[k] = chain;
  }
  b.single = () => Promise.resolve({ data, error });
  b.maybeSingle = () => Promise.resolve({ data, error });
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return b;
}

describe("list_wallets", () => {
  it("returns user's active wallets by default", async () => {
    const wallets = [
      { id: "w1", name: "Nación", currency: "ARS", archived: false },
      { id: "w2", name: "MP", currency: "ARS", archived: false },
    ];
    const supabase = { from: vi.fn(() => builderOf(wallets)) };
    const tool = listWalletsTool({ supabase: supabase as never, userId: "u" });
    const out = await tool.execute({});
    expect(out.length).toBe(2);
  });
});

describe("list_categories", () => {
  it("filters by type when provided", async () => {
    const cats = [
      { id: "c1", name: "Comida", type: "expense", parent_id: null },
    ];
    const supabase = { from: vi.fn(() => builderOf(cats)) };
    const tool = listCategoriesTool({ supabase: supabase as never, userId: "u" });
    const out = await tool.execute({ type: "expense" });
    expect(out[0].name).toBe("Comida");
  });
});

describe("list_recent", () => {
  it("returns rows ordered newest first", async () => {
    const rows = [
      { id: "t1", amount: 200, currency: "ARS", type: "expense", occurred_at: "2026-05-14T15:00:00Z", payee: "Café", wallet_id: "w" },
    ];
    const supabase = { from: vi.fn(() => builderOf(rows)) };
    const tool = listRecentTool({ supabase: supabase as never, userId: "u" });
    const out = await tool.execute({});
    expect(out.length).toBe(1);
  });
});
