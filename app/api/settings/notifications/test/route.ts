import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { sendTelegramMessage } from "@/lib/notifications/telegram";

/**
 * POST /api/settings/notifications/test
 * Send a test Telegram message using the user's saved credentials
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const setting = await prisma.notificationSetting.findUnique({
      where: { userId: session.id },
    });

    if (
      !setting?.telegramEnabled ||
      !setting.telegramBotToken ||
      !setting.telegramChatId
    ) {
      return NextResponse.json(
        {
          error:
            "Telegram notifications not configured. Please set bot token, chat ID, and enable notifications first.",
        },
        { status: 400 },
      );
    }

    const sent = await sendTelegramMessage(
      "🔔 *Test Notification*\n\nYour Telegram notifications are configured correctly!\n\nYou will receive SLA ship\\-by alerts here\\.",
      {
        parseMode: "MarkdownV2",
        credentials: {
          token: setting.telegramBotToken,
          chatId: setting.telegramChatId,
        },
      },
    );

    if (!sent) {
      return NextResponse.json(
        { error: "Failed to send test message. Check your bot token and chat ID." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, message: "Test message sent" });
  } catch (error) {
    logger.error("Error sending test notification", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Failed to send test message" },
      { status: 500 },
    );
  }
}
