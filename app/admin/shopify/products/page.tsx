import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ShopifyProducts from "@/components/shopify/ShopifyProducts";

export default async function ShopifyProductsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <ShopifyProducts />;
}
