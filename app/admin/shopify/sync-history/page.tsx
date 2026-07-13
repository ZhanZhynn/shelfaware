import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ShopifySyncHistory from "@/components/shopify/ShopifySyncHistory";

export default async function ShopifySyncHistoryPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <ShopifySyncHistory />;
}
