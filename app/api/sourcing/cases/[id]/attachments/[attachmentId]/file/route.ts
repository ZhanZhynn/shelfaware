import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { readSourcingAttachment } from "@/lib/sourcing/attachment-storage";
import { requireAssignedSourcer, requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, attachmentId } = await params;
    const sourcingCase = await prisma.sourcingCase.findUnique({ where: { id }, select: { id: true, workspaceId: true, assignedToId: true } });
    if (!sourcingCase) return NextResponse.json({ error: "Sourcing case not found" }, { status: 404 });
    await requireWorkspaceRole(user, sourcingCase.workspaceId, ["admin", "sourcer"]);
    requireAssignedSourcer(user, sourcingCase.assignedToId);
    const attachment = await prisma.sourcingAttachment.findFirst({ where: { id: attachmentId, caseId: id } });
    if (!attachment || attachment.storage !== "mongodb") return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    const content = await readSourcingAttachment(attachment.fileId);
    return new NextResponse(new Uint8Array(content), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `inline; filename="${attachment.fileName.replace(/["\\\r\n]/g, "_")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Attachment download failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 });
  }
}
