import { PrismaClient } from "@prisma/client";
import { assertFreshStartAllowed, getDatabaseTarget } from "./fresh-start-policy";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const workspaceName = process.env.BOOTSTRAP_WORKSPACE_NAME?.trim() || "Jun Workspace";
const memberRole = process.env.BOOTSTRAP_MEMBER_ROLE || "viewer";
const validRoles = new Set(["admin", "sourcer", "warehouse", "viewer"]);

function values(name: string) {
  return (process.env[name] || "").split(",").map((value) => value.trim()).filter(Boolean);
}

async function resolveAdmin() {
  const id = process.env.BOOTSTRAP_ADMIN_ID?.trim();
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!id && !email) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL or BOOTSTRAP_ADMIN_ID for Jun's existing account.");
  const [byId, byEmail] = await Promise.all([id ? prisma.user.findUnique({ where: { id } }) : null, email ? prisma.user.findUnique({ where: { email } }) : null]);
  if (byId && byEmail && byId.id !== byEmail.id) throw new Error("BOOTSTRAP_ADMIN_ID and BOOTSTRAP_ADMIN_EMAIL identify different accounts.");
  const user = byId || byEmail;
  if (!user) throw new Error("The supplied Jun account was not found; bootstrap never creates accounts or placeholder users.");
  return user;
}

async function main() {
  if (!validRoles.has(memberRole)) throw new Error("BOOTSTRAP_MEMBER_ROLE must be admin, sourcer, warehouse, or viewer.");
  if (!workspaceName) throw new Error("BOOTSTRAP_WORKSPACE_NAME must not be empty.");
  const target = getDatabaseTarget(process.env.DATABASE_URL);
  const jun = await resolveAdmin();
  assertFreshStartAllowed(process.env, target, dryRun, "BOOTSTRAP", `${jun.id}:${workspaceName}`);
  console.log(`\nWorkspace bootstrap ${dryRun ? "dry run" : "target"}: ${target.display}`);
  console.log(`Account/workspace: ${jun.email} (${jun.id}) / ${workspaceName}${dryRun ? " (no records will be changed)" : ""}\n`);
  if (dryRun) return;
  if (jun.role !== "admin") await prisma.user.update({ where: { id: jun.id }, data: { role: "admin" } });

  let workspace = await prisma.workspace.findFirst({ where: { name: workspaceName, ownerId: jun.id }, orderBy: { createdAt: "asc" } });
  if (!workspace) workspace = await prisma.workspace.create({ data: { name: workspaceName, ownerId: jun.id } });
  await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: jun.id } }, create: { workspaceId: workspace.id, userId: jun.id, role: "admin" }, update: { role: "admin", updatedAt: new Date() } });

  const candidates = await Promise.all([
    ...values("BOOTSTRAP_MEMBER_EMAILS").map((email) => prisma.user.findUnique({ where: { email: email.toLowerCase() } })),
    ...values("BOOTSTRAP_MEMBER_IDS").map((id) => prisma.user.findUnique({ where: { id } })),
  ]);
  const unresolved = candidates.filter((user) => !user).length;
  const members = [...new Map(candidates.filter((user): user is NonNullable<typeof user> => user !== null).map((user) => [user.id, user])).values()];
  for (const member of members) {
    if (member.id === jun.id) continue;
    await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: member.id } }, create: { workspaceId: workspace.id, userId: member.id, role: memberRole }, update: { role: memberRole, updatedAt: new Date() } });
  }

  console.log(`Workspace ensured: ${workspace.name} (${workspace.id})`);
  console.log(`Jun admin ensured: ${jun.email} (${jun.id})`);
  console.log(`Additional members ensured: ${members.filter((member) => member.id !== jun.id).length}`);
  if (unresolved) console.log(`Skipped unresolved supplied members: ${unresolved} (no accounts were created).`);
  console.log("Next manual setup: configure suppliers, categories, and warehouses; verify marketplace connections; then run marketplace sync from the authenticated UI.");
}

main()
  .catch((error) => {
    console.error(`Workspace bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
