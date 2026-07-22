import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import SourcingPortal from "@/components/sourcing/SourcingPortal";

export default async function SourcingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSession();
  if (!user) redirect("/login/sourcing?next=/sourcing");
  if (user.role === "admin") {
    const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : (value || []).map((entry) => [key, entry]))).toString();
    redirect(`/admin/sourcing${query ? `?${query}` : ""}`);
  }
  return <SourcingPortal />;
}
