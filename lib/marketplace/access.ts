import { getAdminDataScope, type AdminDataActor } from "@/lib/admin/data-scope";

type MarketplaceSession = AdminDataActor;

/** Marketplace connections are shared among the global Admin team. */
export async function marketplaceOwnerIds(user: MarketplaceSession) {
  return (await getAdminDataScope(user)).ownerIds;
}

export function marketplaceCacheScope(user: MarketplaceSession) {
  return user.role === "admin" ? "admin-shared" : `user:${user.id}`;
}
