import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ShopeeAnalyticsContent from "./content";

export default async function ShopeeAnalyticsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <ShopeeAnalyticsContent />;
}
