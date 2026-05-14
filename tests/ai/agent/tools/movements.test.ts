import { describe, expect, it, vi } from "vitest";

import { createMovementsTool } from "@/lib/ai/agent/tools/movements";

function makeCtx() {
  const inserted = [
    {
      id: "tx-1",
      user_id: "u",
      wallet_id: "w",
      amount: 200,
      currency: "ARS",
      type: "expense",
      occurred_at: "2026-05-14T15:00:00Z",
      category_id: "cat-comida",
      payee: "Café",
      description: null,
      photo_path: null,
      source: "telegram_text",
    },
  ];
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "transactions") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: inserted, error: null }),
          }),
        };
      }
      if (table === "telegram_agent_actions") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: "act-1" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return {
    supabase: supabase as never,
    userId: "u",
    chatId: 123,
    mainCurrency: "ARS",
    resolveCategory: vi.fn(async () => ({ id: "cat-comida", label: "Comida" })),
    dedupBatch: vi.fn(async () => [
      { batch_index: 0, is_duplicate: false, duplicate_of_tx_id: null },
    ]),
  };
}

describe("create_movements", () => {
  it("inserts non-duplicate items and returns ids", async () => {
    const ctx = makeCtx();
    const tool = createMovementsTool(ctx);
    const result = await tool.execute({
      items: [
        {
          type: "expense",
          amount: 200,
          currency: "ARS",
          payee: "Café",
          description: null,
          category_hint: "comida",
          subcategory_hint: "café",
          occurred_at: "2026-05-14T15:00:00Z",
          transfer_hint: false,
          external_id: null,
          confidence: 0.95,
        },
      ],
      wallet_id: "w",
    });
    expect(result.created_count).toBe(1);
    expect(result.ids).toEqual(["tx-1"]);
    expect(result.dedup_warnings).toEqual([]);
  });
});
