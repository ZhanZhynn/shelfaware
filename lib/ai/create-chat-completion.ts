/**
 * LLM orchestrator: OpenCode Zen first, Groq fallback on failure.
 * Used by /api/ai/insights and forecasting AI helpers.
 */

import { createGroqChatCompletion, isGroqConfigured } from "./groq";
import { createZenChatCompletion, isZenConfigured } from "./opencode-zen";
import type {
  ChatCompletionFailureKind,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatMessage,
} from "./types";

export type {
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatCompletionFailureKind,
  ChatCompletionResult,
  LlmProvider,
  ToolCall,
  ToolDefinition,
  ToolFunctionSpec,
} from "./types";

/** Re-export for callers that only check Zen */
export { isZenConfigured as isOpenRouterConfigured } from "./opencode-zen";
export { isZenConfigured } from "./opencode-zen";
export { isGroqConfigured } from "./groq";

/** True when at least one provider has an API key */
export function isLlmConfigured(): boolean {
  return isZenConfigured() || isGroqConfigured();
}

const FALLBACK_KINDS: ChatCompletionFailureKind[] = [
  "billing",
  "rate_limit",
  "upstream",
  "not_configured",
];

function shouldTryGroqFallback(
  zenResult: Extract<ChatCompletionResult, { ok: false }>,
): boolean {
  if (!isGroqConfigured()) {
    return false;
  }
  return FALLBACK_KINDS.includes(zenResult.kind);
}

/**
 * Try OpenCode Zen; on billing/rate-limit/upstream/not_configured, try Groq.
 */
export async function createChatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  const zenResult = await createZenChatCompletion(messages, options);

  if (zenResult.ok) {
    return zenResult;
  }

  if (shouldTryGroqFallback(zenResult)) {
    console.warn(
      "[LLM] OpenCode Zen failed, trying Groq fallback:",
      zenResult.kind,
    );
    const groqResult = await createGroqChatCompletion(messages, options);
    if (groqResult.ok) {
      return groqResult;
    }
    return groqResult;
  }

  return zenResult;
}
