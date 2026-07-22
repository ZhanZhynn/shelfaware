import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { ensureWorkspaceAdminRetention, requireGlobalAdmin, SourcingAccessError, withWorkspaceAdminGuard } from "@/lib/sourcing/auth";
import { normalizeInvitationEmail, hashInvitationToken, sendWorkspaceInvitation } from "@/lib/sourcing/invitations";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";

const addSchema = z.object({ workspaceId: z.string().regex(/^[a-f\d]{24}$/i), email: z.string().email().max(254), name: z.string().trim().max(120).optional(), invite: z.boolean().default(true), confirmRoleChange: z.boolean().default(false) });
const actionSchema = z.object({ invitationId: z.string().regex(/^[a-f\d]{24}$/i), action: z.enum(["resend", "revoke"]) });

async function admin(request: NextRequest) {
  const user = await getSessionFromRequest(request);
  if (!user) throw new SourcingAccessError("Unauthorized", 401);
  await requireGlobalAdmin(user);
  return user;
}

export async function GET(request: NextRequest) {
  try {
    await admin(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId || !/^[a-f\d]{24}$/i.test(workspaceId)) return NextResponse.json({ error: "Valid workspaceId is required" }, { status: 400 });
    const [members, invitations] = await Promise.all([
      prisma.workspaceMember.findMany({ where: { workspaceId, role: "sourcer" }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.workspaceInvitation.findMany({ where: { workspaceId, status: "pending" }, select: { id: true, email: true, name: true, expiresAt: true, sentAt: true }, orderBy: { sentAt: "desc" } }),
    ]);
    return NextResponse.json({ members: members.map((member) => ({ id: member.id, userId: member.userId, name: member.user.name, email: member.user.email })), invitations });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load sourcers" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await admin(request);
    const limited = await withRateLimit(request, defaultRateLimits.strict, user.id); if (limited) return limited;
    const body = addSchema.parse(await request.json()); const email = normalizeInvitationEmail(body.email);
    const workspace = await prisma.workspace.findUnique({ where: { id: body.workspaceId }, select: { id: true, name: true } });
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.status !== "approved") return NextResponse.json({ error: "This account is not approved and cannot be added." }, { status: 409 });
      const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: existing.id } } });
      if (member && member.role === "sourcer") return NextResponse.json({ status: "already_member" });
      if (member && !body.confirmRoleChange) return NextResponse.json({ error: `This account is already a ${member.role}. Confirm the role change to continue.`, code: "ROLE_CHANGE_CONFIRMATION_REQUIRED" }, { status: 409 });
      await withWorkspaceAdminGuard(workspace.id, async (tx) => {
        const current = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: existing.id } } });
        if (current?.role === "admin") {
          const adminCount = await tx.workspaceMember.count({ where: { workspaceId: workspace.id, role: "admin" } });
          ensureWorkspaceAdminRetention(current.role, "sourcer", adminCount);
        }
        await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: existing.id } }, create: { workspaceId: workspace.id, userId: existing.id, role: "sourcer" }, update: { role: "sourcer", updatedAt: new Date() } });
      });
      await prisma.notification.create({ data: { userId: existing.id, type: "workspace_membership", title: "Sourcing access granted", message: `You were added as a sourcer for ${workspace.name}.`, link: "/sourcing" } });
      return NextResponse.json({ status: "attached" });
    }
    if (!body.invite) return NextResponse.json({ error: "No approved account exists for this email. Send an invitation instead." }, { status: 409 });
    const token = crypto.randomBytes(32).toString("base64url");
    await prisma.workspaceInvitation.updateMany({ where: { workspaceId: workspace.id, email, status: "pending" }, data: { status: "revoked", revokedAt: new Date() } });
    const invitation = await prisma.workspaceInvitation.create({ data: { workspaceId: workspace.id, email, name: body.name || null, tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdById: user.id } });
    void sendWorkspaceInvitation({ email, name: invitation.name, token, workspaceName: workspace.name });
    return NextResponse.json({ status: "invited" }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to add sourcer" }, { status: error instanceof SourcingAccessError ? error.status : error instanceof z.ZodError ? 400 : 500 }); }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await admin(request); const limited = await withRateLimit(request, defaultRateLimits.strict, user.id); if (limited) return limited;
    const { invitationId, action } = actionSchema.parse(await request.json());
    const invitation = await prisma.workspaceInvitation.findUnique({ where: { id: invitationId }, include: { workspace: { select: { name: true } } } });
    if (!invitation || invitation.status !== "pending") return NextResponse.json({ error: "Pending invitation not found" }, { status: 404 });
    if (action === "revoke") { await prisma.workspaceInvitation.update({ where: { id: invitation.id }, data: { status: "revoked", revokedAt: new Date() } }); return NextResponse.json({ status: "revoked" }); }
    const token = crypto.randomBytes(32).toString("base64url");
    await prisma.workspaceInvitation.update({ where: { id: invitation.id }, data: { tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), sentAt: new Date() } });
    void sendWorkspaceInvitation({ email: invitation.email, name: invitation.name, token, workspaceName: invitation.workspace.name });
    return NextResponse.json({ status: "resent" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update invitation" }, { status: error instanceof SourcingAccessError ? error.status : error instanceof z.ZodError ? 400 : 500 }); }
}
