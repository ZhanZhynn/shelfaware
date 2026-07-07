import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import LazadaOrders from "@/components/lazada/LazadaOrders";

export default async function LazadaOrdersPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <LazadaOrders />;
}
