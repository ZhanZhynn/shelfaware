import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import SourcingVariantEditPage from "@/components/sourcing/SourcingVariantEditPage";

export default async function AdminSourcingEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return <SourcingVariantEditPage caseId={(await params).id} />;
}
