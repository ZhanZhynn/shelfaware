/**
 * Telegram notification helper
 * Sends messages via Telegram Bot API.
 * Reads credentials from DB (NotificationSetting) first, falls back to env vars.
 * Graceful no-op if no credentials are configured.
 */

import { logger } from "@/lib/logger";
import prisma from "@/prisma/client";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Escape special characters for Telegram MarkdownV2 format.
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Resolve Telegram credentials: DB first, env fallback.
 * Returns null if not configured.
 */
async function getTelegramCredentials(): Promise<{
  token: string;
  chatId: string;
} | null> {
  // Try DB first — find any user with telegram enabled
  try {
    const setting = await prisma.notificationSetting.findFirst({
      where: { telegramEnabled: true },
    });

    if (setting?.telegramBotToken && setting?.telegramChatId) {
      return {
        token: setting.telegramBotToken,
        chatId: setting.telegramChatId,
      };
    }
  } catch (err) {
    logger.warn("[Telegram] Failed to read from DB, falling back to env:", err);
  }

  // Fallback to env vars
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  const envChatId = process.env.TELEGRAM_CHAT_ID;

  if (envToken && envChatId) {
    return { token: envToken, chatId: envChatId };
  }

  return null;
}

/**
 * Send a message via Telegram Bot API.
 * @param text - Message text
 * @param options - Parse mode, silent mode, and optional explicit credentials
 * @returns true if sent successfully, false if skipped or failed
 */
export async function sendTelegramMessage(
  text: string,
  options?: {
    parseMode?: "MarkdownV2" | "HTML" | "Markdown";
    silent?: boolean;
    /** Override credentials (e.g. for test endpoint) */
    credentials?: { token: string; chatId: string };
  },
): Promise<boolean> {
  const creds = options?.credentials ?? (await getTelegramCredentials());

  if (!creds) {
    logger.info(
      "[Telegram] No credentials configured (DB or env) — skipping notification",
    );
    return false;
  }

  try {
    const url = `${TELEGRAM_API}/bot${creds.token}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: creds.chatId,
      text,
      disable_notification: options?.silent ?? false,
    };
    if (options?.parseMode) {
      body.parse_mode = options.parseMode;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error(`[Telegram] API error ${response.status}: ${errBody}`);
      return false;
    }

    logger.info("[Telegram] Message sent successfully");
    return true;
  } catch (err) {
    logger.error("[Telegram] Failed to send message:", err);
    return false;
  }
}

export { escapeMarkdownV2 };
