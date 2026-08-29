import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId)
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin", "sourcer"]);
    const orders = await prisma.sourcingOrder.findMany({
      where: {
        workspaceId,
        ...(user.role === "sourcer" ? { sourcingCase: { assignedToId: user.id } } : {}),
      },
      include: {
        sourcingCase: {
          select: {
            id: true,
            title: true,
            attachments: {
              where: { mimeType: { startsWith: "image/" } },
              orderBy: { createdAt: "desc" },
              select: { url: true, fileName: true, caseVariantId: true },
            },
          },
        },
        purchaseOrder: {
          include: { supplier: { select: { id: true, name: true } }, items: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(
      orders.flatMap((order) =>
        order.purchaseOrder
          ? [{ ...order.purchaseOrder, sourcingCase: order.sourcingCase }]
          : [],
      ),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load supplier orders" },
      { status: error instanceof SourcingAccessError ? error.status : 500 },
    );
  }
}
