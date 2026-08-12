import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { isSharedSkuMappingEnabled } from "@/lib/marketplace-attribution/feature-flags";
import SkuMappingInbox from "@/components/sku-mapping/SkuMappingInbox";

export default async function SharedSkuMappingPage() {
  if (!isSharedSkuMappingEnabled()) redirect("/");
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "sourcer") redirect("/");
  return <SkuMappingInbox canMutate={session.role === "admin"} />;
}
