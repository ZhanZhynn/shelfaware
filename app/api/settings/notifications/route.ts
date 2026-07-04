import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { z } from "zod";

const updateNotificationSettingsSchema = z.object({
  telegramBotToken: z.string().optional().nullable(),
  telegramChatId: z.string().optional().nullable(),
  telegramEnabled: z.boolean().optional(),
});

/**
 * GET /api/settings/notifications
 * Get current user's notification settings
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await prisma.notificationSetting.findUnique({
      where: { userId: session.id },
    });

    return NextResponse.json({
      telegramBotToken: settings?.telegramBotToken ?? "",
      telegramChatId: settings?.telegramChatId ?? "",
      telegramEnabled: settings?.telegramEnabled ?? false,
    });
  } catch (error) {
    logger.error("Error fetching notification settings", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Failed to fetch notification settings" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/settings/notifications
 * Update current user's notification settings
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validationResult = updateNotificationSettingsSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: validationResult.error.errors,
        },
        { status: 400 },
      );
    }

    const data = validationResult.data;

    const settings = await prisma.notificationSetting.upsert({
      where: { userId: session.id },
      update: {
        telegramBotToken: data.telegramBotToken ?? undefined,
        telegramChatId: data.telegramChatId ?? undefined,
        telegramEnabled: data.telegramEnabled ?? undefined,
      },
      create: {
        userId: session.id,
        telegramBotToken: data.telegramBotToken ?? null,
        telegramChatId: data.telegramChatId ?? null,
        telegramEnabled: data.telegramEnabled ?? false,
      },
    });

    return NextResponse.json({
      telegramBotToken: settings.telegramBotToken ?? "",
      telegramChatId: settings.telegramChatId ?? "",
      telegramEnabled: settings.telegramEnabled,
    });
  } catch (error) {
    logger.error("Error updating notification settings", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Failed to update notification settings" },
      { status: 500 },
    );
  }
}
