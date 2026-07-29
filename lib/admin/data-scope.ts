import { prisma } from "@/prisma/client";

export type AdminDataActor = { id: string; role: string | null };
export type AdminDataScope = {
  ownerIds: string[];
  sharedAdmin: boolean;
  cacheScope: string;
};

/**
 * Global Admin accounts operate one shared data domain. Other roles remain
 * constrained to their own records and must not receive this owner set.
 */
export async function getAdminDataScope(
  actor: AdminDataActor,
): Promise<AdminDataScope> {
  if (actor.role !== "admin") {
    return {
      ownerIds: [actor.id],
      sharedAdmin: false,
      cacheScope: `user:${actor.id}`,
    };
  }

  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    select: { id: true, status: true },
  });
  const ownerIds = admins
    // Legacy accounts without a persisted status are treated as approved.
    .filter(
      (admin) => admin.status !== "pending" && admin.status !== "rejected",
    )
    .map((admin) => admin.id);

  return { ownerIds, sharedAdmin: true, cacheScope: "admin-shared" };
}
