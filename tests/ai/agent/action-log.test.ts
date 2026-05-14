import { beforeEach, describe, expect, it, vi } from "vitest";

import { logAction } from "@/lib/ai/agent/action-log";

function makeMockClient() {
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi
        .fn()
        .mockResolvedValue({ data: { id: "act-1" }, error: null }),
    }),
  });
  const from = vi.fn().mockReturnValue({ insert });
  return { from, _insert: insert };
}

describe("logAction", () => {
  let mock: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it("writes a create-type row with after_payload", async () => {
    const id = await logAction(mock as never, {
      userId: "user-1",
      chatId: 123,
      actionType: "create",
      targetIds: ["tx-1", "tx-2"],
      beforePayload: null,
      afterPayload: [{ id: "tx-1" }, { id: "tx-2" }],
      agentSummary: "creó 2 movimientos",
    });
    expect(id).toBe("act-1");
    expect(mock.from).toHaveBeenCalledWith("telegram_agent_actions");
    expect(mock._insert).toHaveBeenCalledWith({
      user_id: "user-1",
      telegram_chat_id: 123,
      action_type: "create",
      target_table: "transactions",
      target_ids: ["tx-1", "tx-2"],
      before_payload: null,
      after_payload: [{ id: "tx-1" }, { id: "tx-2" }],
      agent_summary: "creó 2 movimientos",
    });
  });
});
