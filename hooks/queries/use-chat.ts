/**
 * useChat — React Query mutation that POSTs the accumulated messages to
 * /api/chat and returns the assistant text + tool-call metadata.
 */

import { useMutation } from "@tanstack/react-query";
import axiosInstance from "@/utils/axiosInstance";
import { useToast } from "@/hooks/use-toast";
import type { ChatStoreMessage } from "@/stores/chat";

export interface ChatApiResponse {
  text: string;
  provider?: string;
  hops?: number;
}

interface ChatEnvelope {
  success: boolean;
  data: ChatApiResponse;
  error?: string;
  message?: string;
}

export interface UseChatArgs {
  messages: Pick<ChatStoreMessage, "role" | "content">[];
  model?: string;
}

export function useChatMutation() {
  const { toast } = useToast();
  return useMutation({
    mutationKey: ["chat"],
    mutationFn: async ({ messages, model }: UseChatArgs) => {
      const response = await axiosInstance.post<ChatEnvelope>(
        "/chat",
        {
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          ...(model ? { model } : {}),
        },
        { timeout: 60000 },
      );
      const body = response.data;
      if (!body.success) {
        throw new Error(body.error ?? body.message ?? "Chat failed.");
      }
      return body.data;
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Chat failed. Please try again.";
      toast({ title: "Chat error", description: message, variant: "destructive" });
    },
  });
}