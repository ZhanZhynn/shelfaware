/**
 * Chat request validation — Zod schema for POST /api/chat.
 *
 * The model allowlist is the Zen free-tier ids exported from lib/ai. Any other
 * model id is rejected to prevent the chatbot UI (or a malicious client) from
 * pinning the request to a paid/billing-required model.
 */

import { z } from "zod";
import { ZEN_FREE_MODELS } from "@/lib/ai/opencode-zen";

const messageSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("user"),
    content: z.string().trim().min(1).max(4000),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().trim().max(8000).optional(),
  }),
]);

export const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  model: z.enum(ZEN_FREE_MODELS).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;