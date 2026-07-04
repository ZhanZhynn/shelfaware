"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Send, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface NotificationSettings {
  telegramBotToken: string;
  telegramChatId: string;
  telegramEnabled: boolean;
}

export default function ShopeeNotificationSettings() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => setIsMounted(true));
    return () => { mounted.current = false; };
  }, []);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["notification-settings"],
    queryFn: async () => {
      const response = await fetch("/api/settings/notifications");
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json() as Promise<NotificationSettings>;
    },
    enabled: isMounted,
  });

  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [initialized, setInitialized] = useState(false);

  // Sync form state from query data (runs when data arrives)
  if (settings && !initialized) {
    setBotToken(settings.telegramBotToken);
    setChatId(settings.telegramChatId);
    setEnabled(settings.telegramEnabled);
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramBotToken: botToken,
          telegramChatId: chatId,
          telegramEnabled: enabled,
        }),
      });
      if (!response.ok) throw new Error("Failed to save");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Settings saved", description: "Notification settings updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save notification settings." });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      setTestStatus("loading");
      const response = await fetch("/api/settings/notifications/test", {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Test failed");
      }
      return response.json();
    },
    onSuccess: () => {
      setTestStatus("success");
      toast({ title: "Test sent!", description: "Check your Telegram for the test message." });
      setTimeout(() => setTestStatus("idle"), 3000);
    },
    onError: () => {
      setTestStatus("error");
      toast({ title: "Test failed", description: "Check your bot token and chat ID." });
      setTimeout(() => setTestStatus("idle"), 3000);
    },
  });

  if (!isMounted || isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-32" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Telegram Notifications
        </CardTitle>
        <CardDescription>
          Configure Telegram bot for SLA alerts and order notifications. Get alerts when orders are approaching their ship-by deadline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="telegram-enabled">Enable Telegram Alerts</Label>
            <p className="text-sm text-muted-foreground">
              Receive SLA and order notifications via Telegram
            </p>
          </div>
          <Switch
            id="telegram-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {/* Bot Token */}
        <div className="space-y-2">
          <Label htmlFor="bot-token">Bot Token</Label>
          <div className="relative">
            <Input
              id="bot-token"
              type={showToken ? "text" : "password"}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => setShowToken(!showToken)}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get this from <span className="font-medium">@BotFather</span> on Telegram — send <code className="bg-muted px-1 rounded">/newbot</code> or use an existing bot.
          </p>
        </div>

        {/* Chat ID */}
        <div className="space-y-2">
          <Label htmlFor="chat-id">Chat ID</Label>
          <Input
            id="chat-id"
            type="text"
            placeholder="-1001234567890"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            For groups: add the bot to a group, send a message, then visit{" "}
            <code className="bg-muted px-1 rounded text-xs">
              api.telegram.org/bot{"<TOKEN>"}/getUpdates
            </code>{" "}
            to find the chat ID (negative number for groups).
          </p>
        </div>

        {/* Status indicator */}
        {settings?.telegramBotToken && settings?.telegramChatId && settings?.telegramEnabled && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle className="h-4 w-4" />
            <span>Telegram notifications are active</span>
          </div>
        )}
        {(!settings?.telegramBotToken || !settings?.telegramChatId || !settings?.telegramEnabled) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Configure token, chat ID, and enable to start receiving alerts</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
          <Button
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={!botToken || !chatId || testStatus === "loading"}
          >
            <Send className="h-4 w-4 mr-2" />
            {testStatus === "loading"
              ? "Sending..."
              : testStatus === "success"
                ? "Sent!"
                : testStatus === "error"
                  ? "Failed"
                  : "Send Test Message"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
