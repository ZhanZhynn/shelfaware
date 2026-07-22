import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { deleteSourcingAttachmentFromImageKit, uploadSourcingAttachmentToImageKit } from "@/lib/imagekit";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateAllServerCaches } from "@/lib/cache";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { validateSourcingAttachment } from "@/lib/sourcing/attachments";

async function caseForUser(request: NextRequest, id: string) {
  const user = await getSessionFromRequest(request);
  if (!user) throw new SourcingAccessError("Unauthorized", 401);
  const sourcingCase = await prisma.sourcingCase.findUnique({ where: { id }, select: { id: true, workspaceId: true } });
  if (!sourcingCase) throw new SourcingAccessError("Sourcing case not found", 404);
  await requireWorkspaceRole(user, sourcingCase.workspaceId, ["admin", "sourcer"]);
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
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
    const validationError = validateSourcingAttachment(file);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const uploaded = await uploadSourcingAttachmentToImageKit(
      Buffer.from(await file.arrayBuffer()),
      file.name,
      `/stock-inventory/sourcing/${sourcingCase.workspaceId}/${sourcingCase.id}/`,
    );
    try {
      const attachment = await prisma.sourcingAttachment.create({ data: { workspaceId: sourcingCase.workspaceId, caseId: sourcingCase.id, uploadedById: user.id, fileName: file.name, mimeType: file.type, fileSize: file.size, url: uploaded.url, fileId: uploaded.fileId } });
      void invalidateAllServerCaches();
      return NextResponse.json({ ...attachment, canDelete: true }, { status: 201 });
    } catch (error) {
      await deleteSourcingAttachmentFromImageKit(uploaded.fileId).catch(() => {});
      throw error;
    }
  } catch (error) { return failure(error); }
}
