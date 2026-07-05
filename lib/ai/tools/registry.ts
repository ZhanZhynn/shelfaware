/**
 * Tool registry & dispatcher.
 *
 * All read-only chat tools are registered here. The /api/chat endpoint uses
 * `getToolDefinitions()` to advertise tools to the LLM and `dispatchTool()`
 * to execute a tool call the model emitted.
 */

import { logger } from "@/lib/logger";
import type { ToolCall } from "../types";
import type { ChatTool, ToolHandler, ToolResult, ToolSession } from "./types";
import { inventoryTools } from "./inventory";
import { shopeeTools } from "./shopee";

/** All registered tools keyed by function name. */
const toolsByName: Record<string, ChatTool> = Object.fromEntries(
  [...inventoryTools, ...shopeeTools].map((t) => [t.definition.function.name, t]),
);

/** Tools advertised to the model — array of {type:"function",function:{...}}. */
export function getToolDefinitions() {
  return Object.values(toolsByName).map((t) => t.definition);
}

/** Execute a single tool call by name with the parsed args + session. */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  session: ToolSession,
): Promise<ToolResult> {
  const tool = toolsByName[name];
  if (!tool) {
    logger.warn(`[chat-tools] Unknown tool requested: ${name}`);
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  try {
    return await tool.handler(args, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed";
    logger.error(`[chat-tools] Handler ${name} threw:`, error);
    return { ok: false, error: message };
  }
}

/** Parse the raw tool_call.function.arguments JSON string safely. */
export function parseToolCallArgs(call: ToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Only exported for tests. */
export const __handlersForTests: Record<string, ToolHandler> = Object.fromEntries(
  Object.entries(toolsByName).map(([k, v]) => [k, v.handler]),
);