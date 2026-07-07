import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import LazadaOverview from "@/components/lazada/LazadaOverview";

export default async function LazadaPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <LazadaOverview />;
}
