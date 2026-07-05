/**
 * Shared types for LLM chat providers (OpenCode Zen, Groq).
 * Both use OpenAI-compatible chat/completions JSON shape.
 *
 * Extended to support OpenAI-style function/tool-calling so the chatbot
 * can ask the backend to execute read-only tools (Prisma queries, Shopee stats).
 */

export type ChatMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
    }
  | {
      role: "assistant";
      content?: string | null;
      tool_calls?: ToolCall[];
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    };

/** OpenAI tool call object emitted by the model in an assistant message. */
export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

/** JSON-schema function definition advertised to the model. */
export type ToolFunctionSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolDefinition = {
  type: "function";
  function: ToolFunctionSpec;
};

export type ChatCompletionOptions = {
  /** Provider-specific model id */
  model?: string;
  max_tokens?: number;
  temperature?: number;
  /** OpenAI-compatible tool definitions; when provided the model may emit tool_calls. */
  tools?: ToolDefinition[];
  /** "auto" | "none" | {"type":"function","function":{"name":...}} */
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
};

export type ChatCompletionResponse = {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type ChatCompletionFailureKind =
  | "not_configured"
  | "billing"
  | "rate_limit"
  | "upstream";

export type LlmProvider = "opencode-zen" | "groq";

export type ChatCompletionResult =
  | { ok: true; data: ChatCompletionResponse; provider: LlmProvider }
  | {
      ok: false;
      kind: ChatCompletionFailureKind;
      provider?: LlmProvider;
      status?: number;
      message?: string;
    };