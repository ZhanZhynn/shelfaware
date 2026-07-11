import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import TikTokSyncHistory from "@/components/tiktok/TikTokSyncHistory";

export default async function TikTokSyncHistoryPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <TikTokSyncHistory />;
}
