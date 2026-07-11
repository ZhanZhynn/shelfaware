import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import TikTokProducts from "@/components/tiktok/TikTokProducts";

export default async function TikTokProductsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <TikTokProducts />;
}
