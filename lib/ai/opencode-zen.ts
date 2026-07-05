/**
 * OpenCode Zen API client (OpenAI-compatible).
 * Primary LLM provider for AI insights and forecasting.
 * Docs: https://opencode.ai/docs/zen/
 *
 * Free models available: mimo-v2.5-free, deepseek-v4-flash-free,
 * big-pickle, north-mini-code-free, nemotron-3-ultra-free
 */

import type {
  ChatCompletionOptions,
  ChatCompletionFailureKind,
  ChatCompletionResponse,
  ChatCompletionResult,
  ChatMessage,
} from "./types";

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";

/** Default model when none specified — free tier, no billing required. */
export const DEFAULT_ZEN_MODEL = "mimo-v2.5-free";

/**
 * Free-tier Zen model ids. Used by the chatbot UI model picker.
 * Larger models (nemotron) are more reliable at emitting `tool_calls`.
 */
export const ZEN_FREE_MODELS = [
  "mimo-v2.5-free",
  "deepseek-v4-flash-free",
  "big-pickle",
  "north-mini-code-free",
  "nemotron-3-ultra-free",
  "gpt-5-nano",
] as const;

/** Model most likely to support OpenAI-style tool-calling reliably. */
export const DEFAULT_CHAT_MODEL = "nemotron-3-ultra-free";

/** True when the model id is one of the advertised free Zen models. */
export function isZenFreeModel(model: string): boolean {
  return (ZEN_FREE_MODELS as readonly string[]).includes(model);
}

export function isZenConfigured(): boolean {
  const key = process.env.OPENCODE_ZEN_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

function mapHttpStatusToKind(status: number): ChatCompletionFailureKind {
  if (status === 402) {
    return "billing";
  }
  if (status === 429) {
    return "rate_limit";
  }
  return "upstream";
}

/**
 * Create a chat completion via OpenCode Zen.
 */
export async function createZenChatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  if (!isZenConfigured()) {
    return { ok: false, kind: "not_configured", provider: "opencode-zen" };
  }

  const apiKey = process.env.OPENCODE_ZEN_API_KEY!;
  const model = options.model ?? DEFAULT_ZEN_MODEL;

  try {
    const response = await fetch(`${ZEN_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.max_tokens ?? 1024,
        temperature: options.temperature ?? 0.7,
        ...(options.tools
          ? {
              tools: options.tools,
              tool_choice: options.tool_choice ?? "auto",
            }
          : {}),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      const kind = mapHttpStatusToKind(response.status);
      console.error("[OpenCode Zen] API error:", response.status, text);
      return {
        ok: false,
        kind,
        provider: "opencode-zen",
        status: response.status,
        message: text.slice(0, 500),
      };
    }

    const data = (await response.json()) as ChatCompletionResponse;
    return { ok: true, data, provider: "opencode-zen" };
  } catch (error) {
    console.error("[OpenCode Zen] Request failed:", error);
    return {
      ok: false,
      kind: "upstream",
      provider: "opencode-zen",
      message: error instanceof Error ? error.message : "Request failed",
    };
  }
}
