import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import PurchaseOrderDetail from "@/components/purchase-orders/PurchaseOrderDetail";

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  return <PurchaseOrderDetail id={(await params).id} />;
}
