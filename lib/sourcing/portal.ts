import { prisma } from "@/prisma/client";
export { safeSourcingDestination, sourcingDestination, canonicalAdminSourcingPath } from "./routing";

export async function hasSourcingAccess(user: { id: string; role: string | null }) {
  if (user.role === "admin" || user.role === "sourcer") return true;
  return Boolean(await prisma.workspaceMember.findFirst({
    where: { userId: user.id, role: { in: ["admin", "sourcer"] } },
    select: { id: true },
  }));
}
