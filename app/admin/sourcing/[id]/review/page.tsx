import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import SupplierOrderReview from "@/components/sourcing/SupplierOrderReview";

export default async function AdminSourcingCaseReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return <SupplierOrderReview caseId={(await params).id} />;
}
