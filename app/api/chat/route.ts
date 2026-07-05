/**
 * POST /api/chat — admin chatbot with read-only tool-calling.
 *
 * Flow:
 * 1. Auth + rate limit + Zod-validated body ({messages, model?}).
 * 2. Build the LLM tool list from the registry and run a max-6-hop loop:
 *    - Call createChatCompletion with tools + accumulated messages.
 *    - If the model answers with no tool_calls -> return the text.
 *    - If the model emits tool_calls -> dispatch each one (read-only handlers
 *      scoped to the session user), append the tool results to messages,
 *      then loop again.
 * 3. After MAX_TOOL_HOPS, force a final summary call with tool_choice:"none".
 *
 * Never mutates DB; never triggers Shopee live API or sync.
 */

import { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { createChatCompletion, isLlmConfigured } from "@/lib/ai";
import {
  getToolDefinitions,
  dispatchTool,
  parseToolCallArgs,
} from "@/lib/ai/tools";
import type {
  ChatMessage,
  ChatCompletionResult,
  LlmProvider,
  ToolCall,
} from "@/lib/ai/types";
import { DEFAULT_CHAT_MODEL, isZenFreeModel } from "@/lib/ai/opencode-zen";
import {
  successResponse,
  errorResponse,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from "@/lib/api/response-helpers";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { chatRequestSchema } from "@/lib/validations/chat";
import { logger } from "@/lib/logger";

const MAX_TOOL_HOPS = 6;
const LLM_NOT_CONFIGURED =
  "Chat is not configured. Set OPENCODE_ZEN_API_KEY and/or GROQ_API_KEY in .env.";

const SYSTEM_PROMPT = `You are an inventory and Shopee operations assistant for an authenticated warehouse admin.
You have read-only access to the user's inventory, orders, suppliers, categories, warehouses,
and synced Shopee data via function tools.

Rules:
- ALWAYS prefer calling a tool when you need fresh data instead of guessing.
- Tools are strictly read-only — you cannot create, update, or delete anything.
- Keep answers concise and actionable. Use short bullet points when listing items.
- When the user asks about ShopeeSLA / ship-by deadlines, call getShopeeNearSlaOrders.
- When asked about stock health, call getInventorySummary and/or getLowStockProducts.
- Cite the numbers the tools returned — do not invent numbers.
- If a tool returns no rows, say so plainly instead of fabricating data.`;

function extractAssistantMessage(
  result: ChatCompletionResult,
): { content: string | null; toolCalls: ToolCall[] } | null {
  if (!result.ok) return null;
  const choice = result.data.choices?.[0];
  if (!choice) return null;
  return {
    content: choice.message.content ?? null,
    toolCalls: choice.message.tool_calls ?? [],
  };
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(
    request,
    defaultRateLimits.standard,
  );
  if (rateLimitResponse) return rateLimitResponse;

  const session = await getSessionFromRequest(request);
  if (!session) return unauthorizedResponse();

  if (!isLlmConfigured()) {
    return serviceUnavailableResponse(LLM_NOT_CONFIGURED, {
      code: "LLM_NOT_CONFIGURED",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid request body", 400, {
      details: parsed.error.errors,
    });
  }

  const { messages, model } = parsed.data;

  // Pick the model id. Only Zen free-tier ids pass the schema; for the chat
  // route we always go through the Zen primary path (Groq stays as the
  // fallback inside createChatCompletion), so we resolve the Zen model here.
  const requestedModel = model && isZenFreeModel(model) ? model : DEFAULT_CHAT_MODEL;

  const toolSession = {
    id: session.id,
    role: session.role,
    name: session.name,
    email: session.email,
  };
  const tools = getToolDefinitions();

  const conversation: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map((m): ChatMessage => {
      if (m.role === "user") return { role: "user", content: m.content };
      if (m.role === "system") return { role: "system", content: m.content };
      return { role: "assistant", content: m.content ?? "" };
    }),
  ];

  let provider: LlmProvider | undefined;

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const isFinalHop = hop === MAX_TOOL_HOPS - 1;
    const result = await createChatCompletion(conversation, {
        model: requestedModel,
        max_tokens: 1024,
        temperature: 0.3,
        tools: isFinalHop ? undefined : tools,
        tool_choice: isFinalHop ? "none" : "auto",
      },
    );

    if (!result.ok) {
      if (result.kind === "billing") {
        return serviceUnavailableResponse(
          "AI credits exhausted. Add Zen credits or set GROQ_API_KEY.",
          { code: "LLM_BILLING", provider: result.provider },
        );
      }
      if (result.kind === "not_configured") {
        return serviceUnavailableResponse(LLM_NOT_CONFIGURED, {
          code: "LLM_NOT_CONFIGURED",
        });
      }
      if (result.kind === "rate_limit") {
        return serviceUnavailableResponse(
          "AI rate limit reached. Please try again later.",
          { code: "LLM_RATE_LIMIT", provider: result.provider },
        );
      }
      return errorResponse("AI service is temporarily unavailable", 502, {
        code: "LLM_UPSTREAM",
        provider: result.provider,
        status: result.status,
      });
    }

    provider = result.provider;
    const extracted = extractAssistantMessage(result);
    if (!extracted) {
      return errorResponse("AI service returned no message", 502);
    }

    const { content, toolCalls } = extracted;

    if (!toolCalls || toolCalls.length === 0 || isFinalHop) {
      const text = content?.trim() || "I couldn't find an answer right now.";
      return successResponse({
        text,
        provider,
        hops: hop + 1,
      });
    }

    conversation.push({
      role: "assistant",
      content: content ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const args = parseToolCallArgs(call);
      const toolResult = await dispatchTool(
        call.function.name,
        args,
        toolSession,
      );
      conversation.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        tool_call_id: call.id,
      });
      logger.info(
        `[chat] tool ${call.function.name} ok=${toolResult.ok}`,
      );
    }
  }

  return successResponse({
    text: "I reached the tool-call limit. Could you narrow your question?",
    provider,
    hops: MAX_TOOL_HOPS,
  });
}