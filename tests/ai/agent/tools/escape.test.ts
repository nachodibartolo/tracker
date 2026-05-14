import { describe, expect, it, vi } from "vitest";

import {
  runReadonlySqlTool,
  validateSelectOnly,
  withLimit,
} from "@/lib/ai/agent/tools/escape";

describe("validateSelectOnly", () => {
  it("accepts a SELECT that filters by user_id = $1", () => {
    expect(() => validateSelectOnly("SELECT * FROM transactions WHERE user_id = $1")).not.toThrow();
  });
  it("accepts a WITH ... SELECT (CTE) that filters by user_id = $1", () => {
    expect(() =>
      validateSelectOnly("WITH x AS (SELECT * FROM transactions WHERE user_id = $1) SELECT * FROM x"),
    ).not.toThrow();
  });
  it("rejects INSERT", () => {
    expect(() => validateSelectOnly("INSERT INTO transactions VALUES (1)")).toThrow();
  });
  it("rejects CTE that wraps an INSERT", () => {
    expect(() =>
      validateSelectOnly(
        "WITH x AS (INSERT INTO transactions VALUES (1) RETURNING *) SELECT * FROM x",
      ),
    ).toThrow();
  });
  it("rejects multiple statements", () => {
    expect(() =>
      validateSelectOnly("SELECT * FROM transactions WHERE user_id = $1; DROP TABLE users"),
    ).toThrow();
  });
  it("rejects SQL that references $1 but not user_id = $1", () => {
    expect(() =>
      validateSelectOnly("SELECT * FROM transactions WHERE amount > 0 LIMIT $1"),
    ).toThrow();
  });
  it("rejects SQL without any $1 placeholder", () => {
    expect(() => validateSelectOnly("SELECT * FROM transactions")).toThrow();
  });
});

describe("withLimit", () => {
  it("appends LIMIT 100 when missing", () => {
    expect(withLimit("SELECT * FROM x")).toBe("SELECT * FROM x LIMIT 100");
  });
  it("preserves an existing LIMIT", () => {
    expect(withLimit("SELECT * FROM x LIMIT 5")).toBe("SELECT * FROM x LIMIT 5");
  });
});

describe("run_readonly_sql tool", () => {
  it("calls the RPC with the user id parameter and returns rows", async () => {
    const supabase = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: [{ total: 1500 }], error: null }),
    };
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const tool = runReadonlySqlTool({
      supabase: supabase as never,
      userId: "u-1",
      chatId: 123,
    });
    const out = await tool.execute({
      sql: "SELECT sum(amount) AS total FROM transactions WHERE user_id = $1",
      why: "user pidió total gastado",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("agent_readonly_query", {
      p_sql: "SELECT sum(amount) AS total FROM transactions WHERE user_id = $1 LIMIT 100",
      p_user_id: "u-1",
    });
    expect(out).toEqual([{ total: 1500 }]);
    infoSpy.mockRestore();
  });
});
