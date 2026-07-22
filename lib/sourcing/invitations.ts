import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/prisma/client";
import { sendEmailViaBrevo } from "@/lib/email";

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
export const normalizeInvitationEmail = (email: string) => email.trim().toLowerCase();
export const hashInvitationToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
export const appOrigin = () => (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

export async function sendWorkspaceInvitation(invitation: { email: string; name: string | null; token: string; workspaceName: string }) {
  const url = `${appOrigin()}/invitations/sourcing/accept?token=${encodeURIComponent(invitation.token)}`;
  return sendEmailViaBrevo({ to: { email: invitation.email, name: invitation.name || undefined }, subject: `Join ${invitation.workspaceName} sourcing`, textContent: `You were invited to source for ${invitation.workspaceName}. Set up your account: ${url}`, htmlContent: `<p>You were invited to source for <strong>${escapeHtml(invitation.workspaceName)}</strong>.</p><p><a href="${escapeHtml(url)}">Set up your sourcing account</a></p>` });
}

export async function acceptWorkspaceInvitation(token: string, name: string, password: string) {
  const tokenHash = hashInvitationToken(token);
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.workspaceInvitation.findUnique({ where: { tokenHash }, include: { workspace: true } });
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= new Date()) throw new Error("This invitation is invalid or has expired.");
    const existing = await tx.user.findUnique({ where: { email: invitation.email } });
    if (existing) throw new Error("An account already exists for this email. Sign in to accept the invitation.");
    const user = await tx.user.create({ data: { email: invitation.email, name: name.trim(), password: await bcrypt.hash(password, 12), role: "user", status: "approved", createdAt: new Date() } });
    await tx.workspaceMember.create({ data: { workspaceId: invitation.workspaceId, userId: user.id, role: "sourcer" } });
    await tx.workspaceInvitation.update({ where: { id: invitation.id }, data: { status: "accepted", acceptedAt: new Date() } });
    return { user, workspaceName: invitation.workspace.name };
  });
}
