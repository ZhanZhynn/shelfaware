import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { invalidateAllServerCaches } from "@/lib/cache";

const templateData = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).optional().nullable(), size: z.string().trim().max(200).optional().nullable(), material: z.string().trim().max(200).optional().nullable(), variant: z.string().trim().max(200).optional().nullable(), specifications: z.string().trim().max(4000).optional().nullable(), requestedQuantity: z.number().int().positive().optional().nullable(), targetUnitPriceMyr: z.number().nonnegative().optional().nullable(), route: z.enum(["yiwu", "other"]).optional() });
const createSchema = z.object({ workspaceId: z.string().min(1), name: z.string().trim().min(1).max(100), data: templateData });

function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Template request failed" }, { status: error instanceof SourcingAccessError ? error.status : 400 }); }

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = new URL(request.url).searchParams.get("workspaceId"); if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin", "sourcer"]);
    return NextResponse.json(await prisma.sourcingTemplate.findMany({ where: { workspaceId }, orderBy: { name: "asc" } }));
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const input = createSchema.parse(await request.json());
    await requireWorkspaceRole(user, input.workspaceId, ["admin", "sourcer"]);
    const template = await prisma.sourcingTemplate.create({ data: { ...input, createdById: user.id } });
    void invalidateAllServerCaches();
    return NextResponse.json(template, { status: 201 });
  } catch (error) { return failure(error); }
}
