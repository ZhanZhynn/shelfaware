import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import {
  getPurchaseOrderById,
  updatePurchaseOrder,
  deletePurchaseOrder,
  authorizePurchaseOrder,
} from "@/prisma/purchase-order";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const authorized = await authorizePurchaseOrder(session, id, ["admin", "warehouse"]);
    const data = authorized && await getPurchaseOrderById(id);
    if (!data) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    logger.error("Error fetching purchase order:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch purchase order" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    if (!await authorizePurchaseOrder(session, id, ["admin"])) {
      return NextResponse.json({ error: "Purchase order not found or unauthorized" }, { status: 404 });
    }
    const data = await updatePurchaseOrder(session.id, id, body);

    if (!data) {
      return NextResponse.json(
        { error: "Purchase order not found or cannot be edited" },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    logger.error("Error updating purchase order:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update purchase order" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!await authorizePurchaseOrder(session, id, ["admin"])) {
      return NextResponse.json({ error: "Purchase order not found or unauthorized" }, { status: 404 });
    }
    const success = await deletePurchaseOrder(session.id, id);

    if (!success) {
      return NextResponse.json(
        { error: "Purchase order not found or cannot be cancelled" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error deleting purchase order:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete purchase order" },
      { status: 500 },
    );
  }
}
