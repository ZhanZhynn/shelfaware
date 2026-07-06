import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ReceivingPage from "@/components/receiving/ReceivingPage";

export default async function ReceivingRoute() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <ReceivingPage />;
}
