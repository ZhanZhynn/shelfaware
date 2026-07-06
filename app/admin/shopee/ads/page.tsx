import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ShopeeAdsDashboard from "@/components/shopee-ads/ShopeeAdsDashboard";

export default async function ShopeeAdsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <ShopeeAdsDashboard />;
}
