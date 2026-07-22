import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { deleteSourcingAttachmentFromImageKit } from "@/lib/imagekit";
import { invalidateAllServerCaches } from "@/lib/cache";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, attachmentId } = await params;
    const sourcingCase = await prisma.sourcingCase.findUnique({ where: { id }, select: { id: true, workspaceId: true } });
    if (!sourcingCase) return NextResponse.json({ error: "Sourcing case not found" }, { status: 404 });
    await requireWorkspaceRole(user, sourcingCase.workspaceId, ["admin", "sourcer"]);
    const attachment = await prisma.sourcingAttachment.findFirst({ where: { id: attachmentId, caseId: sourcingCase.id, uploadedById: user.id } });
    if (!attachment) return NextResponse.json({ error: "Attachment not found or you do not own it" }, { status: 404 });
    await deleteSourcingAttachmentFromImageKit(attachment.fileId);
    await prisma.sourcingAttachment.delete({ where: { id: attachment.id } });
    void invalidateAllServerCaches();
    return NextResponse.json({ success: true });
  } catch (error) {
    const status = error instanceof SourcingAccessError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing attachment deletion failed" }, { status });
  }
}
