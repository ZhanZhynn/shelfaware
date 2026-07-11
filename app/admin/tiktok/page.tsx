import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import TikTokOverview from "@/components/tiktok/TikTokOverview";

export default async function TikTokPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <TikTokOverview />;
}
