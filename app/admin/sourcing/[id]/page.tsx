import SourcingCaseDetail from "@/components/sourcing/SourcingCaseDetail";
export default async function AdminSourcingCasePage({ params }: { params: Promise<{ id: string }> }) { return <SourcingCaseDetail caseId={(await params).id} basePath="/admin/sourcing" />; }
