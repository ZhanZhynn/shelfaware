/**
 * Tool framework internal types.
 *
 * A ChatTool is a tuple of { definition (advertised to the LLM),
 * handler (executed server-side with the resolved user session) }.
 * Tools are strictly READ-ONLY in this MVP — handlers must not mutate DB or
 * trigger Shopee syncs. Each handler is scoped to the authenticated user so
 * cross-tenant data leakage is impossible regardless of what the LLM asks for.
 */

import type { ToolDefinition } from "../types";
import type { User } from "@prisma/client";

/** Session passed to every tool handler — same shape as utils/auth returns. */
export type ToolSession = Pick<User, "id" | "role" | "name" | "email"> & {
  id: string;
};

/** Result of running a tool — stringified JSON is fed back to the LLM. */
export type ToolResult = {
  ok: boolean;
  /** JSON-serializable payload that gets handed back to the model. */
  data?: unknown;
  /** Human-readable error reason for tool failures. */
  error?: string;
};

/** A handler is invoked with parsed arguments the model emitted and the session. */
export type ToolHandler = (
  args: Record<string, unknown>,
  session: ToolSession,
) => Promise<ToolResult>;

export type ChatTool = {
  definition: ToolDefinition;
  handler: ToolHandler;
};