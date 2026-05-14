import { describe, expect, it, vi } from "vitest";

vi.mock("ai", async () => {
  const real = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...real,
    generateText: vi.fn(async () => ({
      text: "Listo, registré tu café.",
      steps: [],
      toolCalls: [],
    })),
    stepCountIs: real.stepCountIs ?? (() => () => true),
  };
});

vi.mock("@/lib/ai/agent/provider", () => ({
  agentModel: {} as never,
  requireGoogleAi: vi.fn(),
}));

import { runExpenseAgent } from "@/lib/ai/agent";
import { generateText } from "ai";

describe("runExpenseAgent", () => {
  it("invokes the model and returns the final text", async () => {
    const supabase = { from: vi.fn() } as never;
    const out = await runExpenseAgent({
      supabase,
      userId: "u",
      chatId: 1,
      mainCurrency: "ARS",
      text: "gasté 200 en café",
    });
    expect(out.text).toBe("Listo, registré tu café.");
  });
});

describe("runExpenseAgent default wallet", () => {
  it("does NOT mention a default wallet when defaultWalletId is unset", async () => {
    const supabase = { from: vi.fn() } as never;
    await runExpenseAgent({
      supabase,
      userId: "u",
      chatId: 1,
      mainCurrency: "ARS",
      text: "gasté 200",
    });
    const args = vi.mocked(generateText).mock.calls.at(-1)?.[0];
    expect(args?.system).not.toMatch(/wallet por defecto/i);
  });

  it("injects default wallet hint into the system prompt when set", async () => {
    const supabase = { from: vi.fn() } as never;
    await runExpenseAgent({
      supabase,
      userId: "u",
      chatId: -1,
      mainCurrency: "ARS",
      text: "gasté 200",
      defaultWalletId: "11111111-1111-1111-1111-111111111111",
    });
    const args = vi.mocked(generateText).mock.calls.at(-1)?.[0];
    expect(args?.system).toMatch(/wallet por defecto/i);
    expect(args?.system).toContain("11111111-1111-1111-1111-111111111111");
  });
});
