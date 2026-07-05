import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ShopeeReturnsContent from "./content";

export default async function ShopeeReturnsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <ShopeeReturnsContent />;
}
