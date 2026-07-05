/**
 * Groq API client (OpenAI-compatible).
 * Fallback when OpenRouter billing/rate-limit/upstream fails.
 * Docs: https://console.groq.com/docs/openai
 */

import type {
  ChatCompletionOptions,
  ChatCompletionFailureKind,
  ChatCompletionResponse,
  ChatCompletionResult,
  ChatMessage,
} from "./types";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** Default when GROQ_MODEL env is unset — no Vercel var required. */
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

export function isGroqConfigured(): boolean {
  const key = process.env.GROQ_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/** OpenRouter ids use provider/model (e.g. openai/gpt-3.5-turbo); Groq uses plain ids. */
function isOpenRouterStyleModelId(model: string): boolean {
  return model.includes("/");
}

/**
 * Resolve Groq model: GROQ_MODEL env, else DEFAULT_GROQ_MODEL.
 * Ignores options.model when it is an OpenRouter slug (forecasting passes openai/*).
 */
export function resolveGroqModel(override?: string): string {
  const fromEnv = process.env.GROQ_MODEL?.trim();
  const trimmed = override?.trim();
  if (trimmed && !isOpenRouterStyleModelId(trimmed)) {
    return trimmed;
  }
  return fromEnv || DEFAULT_GROQ_MODEL;
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
 * Create a chat completion via Groq.
 */
export async function createGroqChatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  if (!isGroqConfigured()) {
    return { ok: false, kind: "not_configured", provider: "groq" };
  }

  const apiKey = process.env.GROQ_API_KEY!;
  const model = resolveGroqModel(options.model);

  try {
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
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
      console.error("[Groq] API error:", response.status, text);
      return {
        ok: false,
        kind,
        provider: "groq",
        status: response.status,
        message: text.slice(0, 500),
      };
    }

    const data = (await response.json()) as ChatCompletionResponse;
    return { ok: true, data, provider: "groq" };
  } catch (error) {
    console.error("[Groq] Request failed:", error);
    return {
      ok: false,
      kind: "upstream",
      provider: "groq",
      message: error instanceof Error ? error.message : "Request failed",
    };
  }
}
