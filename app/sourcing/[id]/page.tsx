import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import SourcingCaseDetail from "@/components/sourcing/SourcingCaseDetail";

export default async function SourcingCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) redirect("/login/sourcing?next=/sourcing"); const id = (await params).id; if (user.role === "admin") redirect(`/admin/sourcing/${id}`);
  return <SourcingCaseDetail caseId={id} />;
}
