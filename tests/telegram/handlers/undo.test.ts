import { describe, expect, it, vi } from "vitest";

import { reverseLastAction } from "@/lib/telegram/handlers/undo";

describe("reverseLastAction (create)", () => {
  it("deletes the created rows and marks reversed", async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "telegram_agent_actions") {
          // First call: getLastReversibleAction returns the action row.
          // Second call: markReversed updates it.
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: "act-1",
                          action_type: "create",
                          target_ids: ["tx-1", "tx-2"],
                          before_payload: null,
                          after_payload: [],
                          agent_summary: "creó 2 movimientos",
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  select: vi
                    .fn()
                    .mockResolvedValue({ data: [{ id: "act-1" }], error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "transactions") {
          return {
            delete: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const result = await reverseLastAction(supabase as never, "u-1");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary).toBe("creó 2 movimientos");
    }
  });
});
