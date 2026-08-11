import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export default async function AbcAnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  const params = await searchParams;
  const allowed = ["view", "period", "tier", "dateFrom", "dateTo"];
  const query = new URLSearchParams();
  for (const key of allowed) { const value = params[key]; if (typeof value === "string") query.set(key, value); }
  const channel = params.channel;
  if (typeof channel === "string" && ["all", "mapped", "needs-mapping"].includes(channel)) query.set("channel", channel);
  redirect(`/admin/inventory/product-performance${query.size ? `?${query}` : ""}`);
}
