import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import SourcingCaseForm from "@/components/sourcing/SourcingCaseForm";
export default async function NewSourcingCasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const user = await getSession(); if (!user) redirect("/login/sourcing?next=/sourcing/new"); if (user.role === "admin") { const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : (value || []).map((entry) => [key, entry]))).toString(); redirect(`/admin/sourcing/new${query ? `?${query}` : ""}`); } return <SourcingCaseForm />; }
