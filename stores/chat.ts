/**
 * Zustand store for the chatbot widget.
 * Holds messages + selected model id and persists to localStorage so the
 * conversation survives page navigations inside /admin.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_CHAT_MODEL, ZEN_FREE_MODELS } from "@/lib/ai/opencode-zen";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatStoreMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

interface ChatState {
  messages: ChatStoreMessage[];
  model: string;
  isOpen: boolean;
  isSending: boolean;
  setOpen: (open: boolean) => void;
  setModel: (model: string) => void;
  appendMessage: (msg: Omit<ChatStoreMessage, "id" | "createdAt">) => void;
  setSending: (sending: boolean) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      model: DEFAULT_CHAT_MODEL,
      isOpen: false,
      isSending: false,
      setOpen: (open) => set({ isOpen: open }),
      setModel: (model) => set({ model }),
      appendMessage: (msg) =>
        set((state) => ({
          messages: [
            ...state.messages,
            { ...msg, id: crypto.randomUUID(), createdAt: Date.now() },
          ],
        })),
      setSending: (isSending) => set({ isSending }),
      clear: () => set({ messages: [] }),
    }),
    {
      name: "chat-store",
      partialize: (state) => ({
        messages: state.messages.slice(-40),
        model: state.model,
      }),
    },
  ),
);

export { ZEN_FREE_MODELS };