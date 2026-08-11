import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export default async function AbcAnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  const params = await searchParams;
  const allowed = ["view", "period", "tier", "channel", "dateFrom", "dateTo"];
  const query = new URLSearchParams();
  for (const key of allowed) { const value = params[key]; if (typeof value === "string") query.set(key, value); }
  redirect(`/admin/inventory/product-performance${query.size ? `?${query}` : ""}`);
}
