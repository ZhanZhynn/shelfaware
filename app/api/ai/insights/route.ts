/**
 * AI-powered inventory insights via OpenRouter (OpenAI-compatible models)
 * POST /api/ai/insights — accepts summary of analytics, returns short AI recommendations
 */

import { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { createChatCompletion, isOpenRouterConfigured } from "@/lib/ai";
import {
  successResponse,
  errorResponse,
  serviceUnavailableResponse,
} from "@/lib/api/response-helpers";

const SYSTEM_PROMPT = `You are a concise inventory advisor. Given a short summary of inventory metrics, reply with 2-4 brief, actionable recommendations (one short sentence each). Focus on reorder suggestions, low-stock attention, and value optimization. Keep the tone professional and direct. Do not use markdown or bullet symbols.`;

const BILLING_MESSAGE =
  "AI credits exhausted. Add credits to your OpenRouter account or set a paid model.";

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) {
      return errorResponse("Unauthorized", 401);
    }

    if (!isOpenRouterConfigured()) {
      return serviceUnavailableResponse(
        "AI insights are not configured. Set OPENROUTER_API_KEY in .env.",
        { code: "OPENROUTER_NOT_CONFIGURED" },
      );
    }

    let body: { summary?: string };
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const summary =
      typeof body?.summary === "string" && body.summary.trim().length > 0
        ? body.summary.trim()
        : null;

    if (!summary) {
      return errorResponse("Missing or empty summary in body", 400);
    }

    const result = await createChatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: summary },
      ],
      { max_tokens: 512, temperature: 0.5 },
    );

    if (!result.ok) {
      if (result.kind === "billing") {
        return serviceUnavailableResponse(BILLING_MESSAGE, {
          code: "OPENROUTER_BILLING",
          status: result.status,
        });
      }
      if (result.kind === "not_configured") {
        return serviceUnavailableResponse(
          "AI insights are not configured. Set OPENROUTER_API_KEY in .env.",
          { code: "OPENROUTER_NOT_CONFIGURED" },
        );
      }
      if (result.kind === "rate_limit") {
        return serviceUnavailableResponse(
          "AI service rate limit reached. Please try again later.",
          { code: "OPENROUTER_RATE_LIMIT", status: result.status },
        );
      }
      return errorResponse(
        "AI service is temporarily unavailable",
        502,
        { code: "OPENROUTER_UPSTREAM", status: result.status },
        { reportToSentry: true },
      );
    }

    const text = result.data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return serviceUnavailableResponse(
        "AI service did not return insights. Try again later.",
        { code: "OPENROUTER_EMPTY_RESPONSE" },
      );
    }

    return successResponse({ text });
  } catch (error) {
    console.error("[AI insights]", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to generate insights",
      500,
    );
  }
}
