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
  gemma4: {} as never,
  requireGoogleAi: vi.fn(),
}));

import { runExpenseAgent } from "@/lib/ai/agent";

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
