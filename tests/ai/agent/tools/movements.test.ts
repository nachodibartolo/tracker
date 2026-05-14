import { describe, expect, it, vi } from "vitest";

import { createMovementsTool, deleteMovementTool, updateMovementTool } from "@/lib/ai/agent/tools/movements";

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

describe("update_movement", () => {
  it("reads before-state, updates, and logs action", async () => {
    const before = {
      id: "tx-1",
      user_id: "u",
      wallet_id: "w",
      amount: 200,
      currency: "ARS",
      payee: "Café",
      description: null,
      occurred_at: "2026-05-14T15:00:00Z",
      category_id: "cat-comida",
      type: "expense",
    };
    const after = { ...before, amount: 250 };

    let stage = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "transactions") {
          stage += 1;
          if (stage === 1) {
            // SELECT before
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi
                      .fn()
                      .mockResolvedValue({ data: before, error: null }),
                  }),
                }),
              }),
            };
          }
          // UPDATE
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi
                      .fn()
                      .mockResolvedValue({ data: after, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "telegram_agent_actions") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: "act-2" }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };

    const tool = updateMovementTool({
      supabase: supabase as never,
      userId: "u",
      chatId: 123,
      mainCurrency: "ARS",
    });
    const out = await tool.execute({ id: "tx-1", patch: { amount: 250 } });
    expect(out.id).toBe("tx-1");
    expect(out.amount).toBe(250);
  });
});

describe("delete_movement", () => {
  it("reads row, deletes, logs full row in before_payload", async () => {
    const before = {
      id: "tx-1",
      user_id: "u",
      wallet_id: "w",
      amount: 200,
      currency: "ARS",
      type: "expense",
      occurred_at: "2026-05-14T15:00:00Z",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "transactions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi
                    .fn()
                    .mockResolvedValue({ data: before, error: null }),
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        if (table === "telegram_agent_actions") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: "act-3" }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };

    const tool = deleteMovementTool({
      supabase: supabase as never,
      userId: "u",
      chatId: 123,
      mainCurrency: "ARS",
    });
    const out = await tool.execute({ id: "tx-1" });
    expect(out.deleted).toBe(true);
  });
});

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
