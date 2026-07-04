import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ShopeeProfitContent from "./content";

export default async function ShopeeProfitPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <ShopeeProfitContent />;
}
