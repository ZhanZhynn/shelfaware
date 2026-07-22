import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import SourcingPurchaseOrderDetail from "@/components/purchase-orders/SourcingPurchaseOrderDetail";

export default async function SourcingPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login/sourcing?next=/sourcing");
  if (user.role === "admin") redirect(`/admin/purchase-orders/${(await params).id}`);
  return <SourcingPurchaseOrderDetail id={(await params).id} />;
}
