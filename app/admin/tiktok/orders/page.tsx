import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import TikTokOrders from "@/components/tiktok/TikTokOrders";

export default async function TikTokOrdersPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <TikTokOrders />;
}
