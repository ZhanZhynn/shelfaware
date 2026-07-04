/**
 * Telegram notification helper
 * Sends messages via Telegram Bot API.
 * Graceful no-op if TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID are not configured.
 */

import { logger } from "@/lib/logger";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Escape special characters for Telegram MarkdownV2 format.
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Send a message via Telegram Bot API.
 * Returns true if sent successfully, false if skipped (missing config) or failed.
 */
export async function sendTelegramMessage(
  text: string,
  options?: {
    parseMode?: "MarkdownV2" | "HTML" | "Markdown";
    silent?: boolean;
  },
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.info(
      "[Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping notification",
    );
    return false;
  }

  try {
    const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
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
