import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ShopifyOrders from "@/components/shopify/ShopifyOrders";

export default async function ShopifyOrdersPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <ShopifyOrders />;
}
