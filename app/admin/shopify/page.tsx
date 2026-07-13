import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ShopifyOverview from "@/components/shopify/ShopifyOverview";

export default async function ShopifyPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <ShopifyOverview />;
}
