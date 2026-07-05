"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, MessageCircle, SendIcon, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChatStore, ZEN_FREE_MODELS } from "@/stores/chat";
import { useChatMutation } from "@/hooks/queries/use-chat";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Show low stock items",
  "Give me an inventory summary",
  "Which Shopee orders are near SLA?",
  "List recent orders",
];

export function ChatWidget() {
  const {
    messages,
    model,
    isOpen,
    isSending,
    setOpen,
    setModel,
    appendMessage,
    setSending,
    clear,
  } = useChatStore();
  const mutation = useChatMutation();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, isSending]);

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || isSending) return;
    appendMessage({ role: "user", content: trimmed });
    setInput("");
    setSending(true);

    const outgoing = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: trimmed },
    ];

    try {
      const data = await mutation.mutateAsync({
        messages: outgoing,
        model,
      });
      appendMessage({ role: "assistant", content: data.text });
    } catch {
      // toast handled in the mutation
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <>
      {/* Floating bubble */}
      <button
        type="button"
        aria-label={isOpen ? "Close chat" : "Open chat"}
        onClick={() => setOpen(!isOpen)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all",
          "bg-primary text-primary-foreground hover:bg-primary/90",
          isOpen && "rotate-90",
        )}
      >
        {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <Card
          className={cn(
            "fixed bottom-24 right-6 z-50 flex h-[32rem] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 shadow-xl",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <span className="font-semibold">Inventory Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                title="Clear conversation"
                disabled={messages.length === 0}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Model picker */}
          <div className="border-b px-4 py-2">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {ZEN_FREE_MODELS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
          >
            {messages.length === 0 && (
              <div className="space-y-2 text-muted-foreground">
                <p className="font-medium text-foreground">Try asking:</p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="block w-full rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex w-full",
                  m.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {isSending && (
              <div className="flex justify-start">
                <div className="bg-muted text-muted-foreground rounded-lg px-3 py-2">
                  <span className="inline-flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-current" />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t p-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about inventory or Shopee orders..."
              rows={2}
              className="resize-none"
              disabled={isSending}
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                onClick={() => void send(input)}
                disabled={!input.trim() || isSending}
              >
                <SendIcon className="h-4 w-4" />
                Send
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

export default ChatWidget;