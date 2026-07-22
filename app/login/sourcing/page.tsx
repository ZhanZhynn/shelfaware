import { getSession } from "@/lib/auth-server";
import { hasSourcingAccess } from "@/lib/sourcing/portal";
import { safeSourcingDestination } from "@/lib/sourcing/routing";
import { redirect } from "next/navigation";
import LoginPage from "@/components/Pages/LoginPage";
export default async function SourcingLogin({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) { const user = await getSession(); const params = await searchParams; if (user && await hasSourcingAccess(user)) redirect(user.role === "admin" ? "/admin/sourcing" : safeSourcingDestination(params.next)); return <LoginPage sourcing />; }
