import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { deleteStoredSourcingAttachment, storeSourcingAttachment } from "@/lib/sourcing/attachment-storage";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateAllServerCaches } from "@/lib/cache";
import {
  requireAssignedSourcer,
  requireWorkspaceRole,
  SourcingAccessError,
} from "@/lib/sourcing/auth";
import { validateSourcingAttachment } from "@/lib/sourcing/attachments";

async function caseForUser(request: NextRequest, id: string) {
  const user = await getSessionFromRequest(request);
  if (!user) throw new SourcingAccessError("Unauthorized", 401);
  const sourcingCase = await prisma.sourcingCase.findUnique({ where: { id }, select: { id: true, workspaceId: true, assignedToId: true } });
  if (!sourcingCase) throw new SourcingAccessError("Sourcing case not found", 404);
  await requireWorkspaceRole(user, sourcingCase.workspaceId, ["admin", "sourcer"]);
  requireAssignedSourcer(user, sourcingCase.assignedToId);
  return { user, sourcingCase };
}

function failure(error: unknown) {
  const status = error instanceof SourcingAccessError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing attachment request failed" }, { status });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, sourcingCase } = await caseForUser(request, (await params).id);
    const attachments = await prisma.sourcingAttachment.findMany({ where: { caseId: sourcingCase.id }, orderBy: { createdAt: "desc" } });
    return NextResponse.json(attachments.map((attachment) => ({ ...attachment, canDelete: attachment.uploadedById === user.id })));
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, sourcingCase } = await caseForUser(request, (await params).id);
    const limited = await withRateLimit(request, defaultRateLimits.standard, `sourcing:attachments:${user.id}`);
    if (limited) return limited;
    const formData = await request.formData();
    const file = formData.get("file");
    const quoteId = formData.get("quoteId");
    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
    if (quoteId !== null && typeof quoteId !== "string") return NextResponse.json({ error: "Invalid quote" }, { status: 400 });
    if (quoteId) {
      const quote = await prisma.sourcingQuote.findFirst({ where: { id: quoteId, caseId: sourcingCase.id }, select: { id: true } });
      if (!quote) return NextResponse.json({ error: "Quote not found for this sourcing case" }, { status: 400 });
    }
    const validationError = validateSourcingAttachment(file);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const fileId = await storeSourcingAttachment(file.name, file.type, Buffer.from(await file.arrayBuffer()));
    try {
      const attachment = await prisma.sourcingAttachment.create({ data: { workspaceId: sourcingCase.workspaceId, caseId: sourcingCase.id, ...(quoteId ? { quoteId } : {}), uploadedById: user.id, fileName: file.name, mimeType: file.type, fileSize: file.size, url: "", fileId, storage: "mongodb" } });
      const url = `/api/sourcing/cases/${sourcingCase.id}/attachments/${attachment.id}/file`;
      const saved = await prisma.sourcingAttachment.update({ where: { id: attachment.id }, data: { url } });
      void invalidateAllServerCaches();
      return NextResponse.json({ ...saved, canDelete: true }, { status: 201 });
    } catch (error) {
      await deleteStoredSourcingAttachment(fileId).catch(() => {});
      throw error;
    }
  } catch (error) { return failure(error); }
}
