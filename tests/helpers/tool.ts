// Test helpers for invoking AI SDK tools.
//
// AI SDK v6 types `tool.execute` as optionally undefined and accepting a
// `ToolCallOptions` argument that we don't care about in unit tests. This
// helper narrows the type and supplies a stub options object so tests stay
// concise.

import type { Tool } from "ai";

/**
 * Invokes the tool's `execute` with a dummy options object. Throws if the
 * tool has no execute function (should never happen for our tools — they
 * all define it).
 *
 * The return value is asserted as the resolved (non-async-iterable) result
 * because every tool in `lib/ai/agent/tools/` returns a value directly.
 */
export async function runTool<INPUT, OUTPUT>(
  t: Tool<INPUT, OUTPUT>,
  input: INPUT,
): Promise<OUTPUT> {
  if (typeof t.execute !== "function") {
    throw new Error("tool has no execute()");
  }
  const result = await t.execute(input, {
    toolCallId: "test-call",
    messages: [],
  } as never);
  return result as OUTPUT;
}
