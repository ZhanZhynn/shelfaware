import { prisma } from "@/prisma/client";

type MarketplaceSession = { id: string; role: string | null };

/** Marketplace connections are shared among the global Admin team. */
export async function marketplaceOwnerIds(user: MarketplaceSession) {
  if (user.role !== "admin") return [user.id];
  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    select: { id: true, status: true },
  });
  return admins
    .filter(
      (admin) => admin.status !== "pending" && admin.status !== "rejected",
    )
    .map((admin) => admin.id);
}

export function marketplaceCacheScope(user: MarketplaceSession) {
  return user.role === "admin" ? "admin-shared" : `user:${user.id}`;
}
