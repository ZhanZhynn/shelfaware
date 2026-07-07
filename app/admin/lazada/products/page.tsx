import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import LazadaProducts from "@/components/lazada/LazadaProducts";

export default async function LazadaProductsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <LazadaProducts />;
}
