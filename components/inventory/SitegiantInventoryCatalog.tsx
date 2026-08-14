"use client";

import { useState, useSyncExternalStore } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, PackageSearch, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = { id: string; isku: string; name: string; active: boolean; kind: "item" | "kit"; physicalStock: string | null; theoreticalKitStock: number | null; productStatus: string | null; components: { quantity: number; isku: string; name: string }[] };
type Data = { rows: Row[]; pagination: { page: number; total: number; totalPages: number } };
type Kind = "all" | "kit" | "item";

export default function SitegiantInventoryCatalog() {
  const hydrated = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<Kind>("all");
  const query = useQuery({
    queryKey: ["sitegiant-inventory", "availability-v2", submittedSearch, kind, page],
    enabled: hydrated,
    queryFn: async () => (await axios.get("/api/inventory/sitegiant", { params: { search: submittedSearch, kind, page }, withCredentials: true })).data as Data,
  });
  if (!hydrated || query.isLoading) return <div className="h-72 animate-pulse rounded-xl bg-muted" />;
  if (!query.data) return <p className="text-destructive">Could not load the Sitegiant inventory catalog.</p>;
  const data = query.data;
  const filterKind = (next: Kind) => { setKind(next); setPage(1); };
  const showComponent = (isku: string) => { setSearch(isku); setSubmittedSearch(isku); setKind("all"); setPage(1); };
  return <div className="mx-auto max-w-6xl space-y-5 px-3 pb-10 sm:px-6">
    <header><div className="flex items-center gap-2"><PackageSearch className="h-6 w-6 text-primary" /><h1 className="text-2xl font-semibold tracking-tight">Sitegiant Inventory</h1></div><p className="mt-1 text-sm text-muted-foreground">Master iSKU catalog imported from Sitegiant. Kit recipes are the source of truth for marketplace analytics.</p></header>
    <section className="rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:px-5"><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setSubmittedSearch(search); setPage(1); }}><Input value={search} onChange={(event) => setSearch(event.target.value)} className="w-72 sm:w-96" placeholder="Search Sitegiant item name or iSKU" /><Button type="submit" size="sm" variant="outline"><Search className="mr-2 h-4 w-4" />Search</Button></form><div className="flex gap-1">{(["all", "kit", "item"] as const).map((value) => <Button key={value} size="sm" variant={kind === value ? "default" : "outline"} onClick={() => filterKind(value)}>{value === "all" ? "All" : value === "kit" ? "Kits" : "Non-kits"}</Button>)}</div></div>
      <div className="grid grid-cols-[minmax(0,1fr)_100px_150px] border-b bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-5"><span>Sitegiant inventory item</span><span>Type</span><span>Available stock</span></div>
      {data.rows.map((row) => <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_100px_150px] gap-3 border-b px-4 py-3 last:border-0 sm:px-5"><div className="min-w-0"><p className="truncate text-sm font-medium">{row.name}</p><p className="mt-1 text-xs text-muted-foreground">iSKU: <code className="text-foreground">{row.isku}</code>{!row.active && " · Inactive"}</p>{row.kind === "kit" && <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-primary">Recipe: {row.components.length ? row.components.map((component, index) => <span key={component.isku}>{index > 0 && " + "}<button className="underline underline-offset-2 hover:text-primary/70" onClick={() => showComponent(component.isku)}>{component.quantity} x {component.isku}</button></span>) : "No current recipe"}</p>}</div><span className={`h-fit w-fit rounded-full px-2 py-0.5 text-xs ${row.kind === "kit" ? "bg-violet-100 text-violet-800" : "bg-muted text-muted-foreground"}`}>{row.kind === "kit" ? "Kit" : "Item"}</span><span className="text-sm">{row.kind === "kit" ? row.theoreticalKitStock == null ? <span className="text-muted-foreground">Component stock unavailable</span> : <><strong>{row.theoreticalKitStock}</strong><span className="mt-0.5 block text-xs text-muted-foreground">theoretical kits</span></> : row.physicalStock ?? "Not imported"}</span></div>)}
      {!data.rows.length && <p className="p-10 text-center text-sm text-muted-foreground">No Sitegiant inventory items match this search.</p>}
    </section>
    <div className="flex items-center justify-between px-1 text-sm text-muted-foreground"><span>{data.pagination.total} iSKUs · page {data.pagination.page} of {data.pagination.totalPages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={data.pagination.page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="h-4 w-4" />Previous</Button><Button size="sm" variant="outline" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight className="h-4 w-4" /></Button></div></div>
  </div>;
}
