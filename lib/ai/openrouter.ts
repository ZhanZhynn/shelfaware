/**
 * OpenRouter API client
 * Use OpenAI-compatible models (and others) via OpenRouter free tier.
 * Base URL: https://openrouter.ai/api/v1
 * Docs: https://openrouter.ai/docs
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterChatOptions {
  /** Model ID (e.g. openai/gpt-4o-mini, openai/gpt-3.5-turbo). Default: openai/gpt-4o-mini */
  model?: string;
  /** Max tokens in response */
  max_tokens?: number;
  /** Temperature 0-2 */
  temperature?: number;
}

export interface OpenRouterChatResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type OpenRouterFailureKind =
  | "not_configured"
  | "billing"
  | "rate_limit"
  | "upstream";

export type OpenRouterResult =
  | { ok: true; data: OpenRouterChatResponse }
  | {
      ok: false;
      kind: OpenRouterFailureKind;
      status?: number;
      message?: string;
    };

/**
 * Check if OpenRouter is configured (API key set and non-empty)
 */
export function isOpenRouterConfigured(): boolean {
  const key = process.env.OPENROUTER_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

function mapHttpStatusToKind(status: number): OpenRouterFailureKind {
  if (status === 402) {
    return "billing";
  }
  if (status === 429) {
    return "rate_limit";
  }
  return "upstream";
}

/**
 * Create a chat completion via OpenRouter (OpenAI-compatible API).
 * Returns a typed result instead of throwing — callers map kind to HTTP status.
 */
export async function createChatCompletion(
  messages: OpenRouterMessage[],
  options: OpenRouterChatOptions = {},
): Promise<OpenRouterResult> {
  if (!isOpenRouterConfigured()) {
    return { ok: false, kind: "not_configured" };
  }

  const apiKey = process.env.OPENROUTER_API_KEY!;
  const model = options.model ?? "openai/gpt-4o-mini";

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.max_tokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      const kind = mapHttpStatusToKind(response.status);
      console.error("[OpenRouter] API error:", response.status, text);
      return {
        ok: false,
        kind,
        status: response.status,
        message: text.slice(0, 500),
      };
    }

    const data = (await response.json()) as OpenRouterChatResponse;
    return { ok: true, data };
  } catch (error) {
    console.error("[OpenRouter] Request failed:", error);
    return {
      ok: false,
      kind: "upstream",
      message: error instanceof Error ? error.message : "Request failed",
    };
  }
}
