import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import LazadaSyncHistory from "@/components/lazada/LazadaSyncHistory";

export default async function LazadaSyncHistoryPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <LazadaSyncHistory />;
}
