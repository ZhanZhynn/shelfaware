import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ShopeeOrders from "@/components/shopee/ShopeeOrders";

export default async function ShopeeOrdersPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <ShopeeOrders />;
}
