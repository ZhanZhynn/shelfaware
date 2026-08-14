"use client";

import { useState, useSyncExternalStore } from "react";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

type ReviewState = "all" | "unlinked" | "draft" | "linked";
type SalesSku = { id: string; code: string; name: string; family: { name: string }; recipe?: { quantity: number; sku: string; name: string }[] };
type Candidate = { id: string; shopId: string; externalProductId: string; externalVariantId: string | null; offerKind: "variant" | "verified-product"; proposedSalesSkuId: string | null; confidence: string };
type ReviewVariant = { modelId: string | null; name: string; rawSku: string; stock: number | null; status: string; state: Exclude<ReviewState, "all">; candidate?: Candidate; proposedSalesSku: SalesSku | null; draftSalesSku: SalesSku | null; mapping?: { id: string; effectiveFrom: string; salesSku: SalesSku } };
type ReviewRow = { shop: { id: string; name: string; externalId: string }; listing: { itemId: string; name: string; rawSku: string | null; imageUrl: string | null; status: string }; variants: ReviewVariant[] };
type ReviewResponse = { rows: ReviewRow[]; catalog: SalesSku[]; pagination: { page: number; totalParents: number; totalPages: number }; counts: Record<ReviewState, number> };
type ReviewTarget = { row: ReviewRow; variant: ReviewVariant };

const tabs: { state: ReviewState; label: string }[] = [
  { state: "all", label: "All Listing" }, { state: "unlinked", label: "Unlinked Listing" },
  { state: "draft", label: "Draft Listing" }, { state: "linked", label: "Linked Listing" },
];

function recipeSummary(sku: SalesSku | null) {
  const components = sku?.recipe ?? [];
  if (!sku || !components.length) return null;
  if (components.length === 1 && components[0]?.sku === sku.code && components[0]?.quantity === 1) return null;
  return components.map((component) => `${component.quantity} x ${component.sku}`).join(" + ");
}

export default function InventoryLinkingReview({ canMutate }: { canMutate: boolean }) {
  const client = useQueryClient();
  // Persisted React Query data can exist in the browser but not during SSR.
  // Hold the query until hydration so both renders start with the same shell.
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const [state, setState] = useState<ReviewState>("all");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [savingDraft, setSavingDraft] = useState(false);
  const query = useQuery({
    queryKey: ["skuMapping", "review", state, submittedSearch, page],
    enabled: hydrated,
    queryFn: async () => (await axios.get("/api/inventory/sku-mapping/review", { params: { state, search: submittedSearch, page }, withCredentials: true })).data as ReviewResponse,
  });
  if (!hydrated || query.isLoading) return <div className="mx-auto h-72 max-w-6xl animate-pulse rounded-xl bg-muted" />;
  if (!query.data) return <p className="text-destructive">Could not load inventory linking.</p>;

  const data = query.data;
  const skuByCode = new Map(data.catalog.map((sku) => [sku.code, sku]));
  const assignedSku = (variant: ReviewVariant) => skuByCode.get(variant.candidate ? assignments[variant.candidate.id] ?? variant.draftSalesSku?.code ?? variant.proposedSalesSku?.code ?? "" : "") ?? null;
  const reviewable = (variant: ReviewVariant) => Boolean(variant.candidate && assignedSku(variant));
  const selectedTargets = data.rows.flatMap((row) => row.variants.map((variant) => ({ row, variant }))).filter(({ variant }) => variant.candidate && selected[variant.candidate.id]);
  const setTab = (next: ReviewState) => { setState(next); setPage(1); setSelected({}); };
  const setParentSelection = (row: ReviewRow, checked: boolean) => setSelected((current) => {
    const next = { ...current };
    for (const variant of row.variants) if (variant.candidate) next[variant.candidate.id] = checked;
    return next;
  });
  const saveDrafts = async (targets: ReviewTarget[]) => {
    setSavingDraft(true);
    await axios.post("/api/inventory/sku-mapping/review", {
      command: "save-drafts",
      links: targets.map(({ variant }) => ({ candidateId: variant.candidate!.id, salesSkuId: assignedSku(variant)!.id })),
    }, { withCredentials: true });
    setSavingDraft(false); setSelected({});
    await client.invalidateQueries({ queryKey: ["skuMapping", "review"] });
  };

  return <div className="mx-auto max-w-6xl space-y-5 px-3 pb-10 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-3 pt-1">
      <div><h1 className="text-2xl font-semibold tracking-tight">Inventory Linking</h1><p className="mt-1 text-sm text-muted-foreground">Link Shopee listings to the matching Sitegiant iSKU before confirming attribution.</p></div>
    </header>

    <section className="rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="flex flex-wrap gap-1">{tabs.map((tab) => <button key={tab.state} onClick={() => setTab(tab.state)} className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${state === tab.state ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{tab.label} <span className="ml-1 text-xs">{data.counts[tab.state]}</span></button>)}</div>
        <div className="flex gap-2"><Button asChild size="sm" variant="outline"><a href="/admin/inventory/sku-mapping/draft">Review Draft Listing ({data.counts.draft})</a></Button>{canMutate && selectedTargets.length > 0 && <Button size="sm" disabled={savingDraft} onClick={() => saveDrafts(selectedTargets)}>{savingDraft ? "Saving…" : `Add to Draft (${selectedTargets.length})`}</Button>}</div>
      </div>
      <form className="flex gap-2 border-b bg-muted/20 p-3 sm:px-5" onSubmit={(event) => { event.preventDefault(); setSubmittedSearch(search); setPage(1); }}><Input value={search} onChange={(event) => setSearch(event.target.value)} className="max-w-lg bg-background" placeholder="Search product name, Shopee SKU, or Sitegiant iSKU" /><Button type="submit" size="sm" variant="outline"><Search className="mr-2 h-4 w-4" />Search</Button></form>
      <div className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] border-b bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-5"><span>Channel Listing</span><span className="text-center">Status</span><span>Sitegiant Inventory</span></div>
      <datalist id="sitegiant-isku-options">{data.catalog.map((sku) => <option key={sku.id} value={sku.code}>{sku.name}</option>)}</datalist>
      {data.rows.map((row) => {
        const allReady = row.variants.length > 0 && row.variants.every(reviewable);
        const allSelected = allReady && row.variants.every((variant) => selected[variant.candidate!.id]);
        return <section key={`${row.shop.id}:${row.listing.itemId}`} className="border-b last:border-0">
          <div className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] items-center gap-3 bg-muted/15 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              {canMutate && <Checkbox checked={allSelected} disabled={!allReady} onCheckedChange={(checked) => setParentSelection(row, checked === true)} aria-label={`Select all variants for ${row.listing.name}`} />}
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted">{row.listing.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- marketplace image hosts are dynamic and not Next Image configured.
                <img src={row.listing.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}</div>
              <div className="min-w-0"><p className="line-clamp-2 text-sm font-medium">{row.listing.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.shop.name} · {row.variants.length} variant{row.variants.length === 1 ? "" : "s"}</p></div>
            </div>
            <div className="text-center text-xs text-muted-foreground">{allReady ? "Ready" : `${row.variants.filter((variant) => !reviewable(variant)).length} need matching`}</div>
            <div className="flex justify-end">{canMutate && allReady && <Button size="sm" variant="outline" disabled={savingDraft} onClick={() => saveDrafts(row.variants.map((variant) => ({ row, variant })))}>{savingDraft ? "Saving…" : "Add to Draft"}</Button>}</div>
          </div>
          {row.variants.map((variant) => {
            const candidate = variant.candidate; const sku = variant.mapping?.salesSku ?? assignedSku(variant); const editing = candidate && editingId === candidate.id; const recipe = recipeSummary(sku);
            return <div key={candidate?.id ?? variant.mapping?.id} className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] gap-3 border-t px-4 py-3 sm:px-5">
              <div className="min-w-0 pl-7"><p className="truncate text-sm font-medium">{variant.name}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">Shopee SKU: <code className="text-foreground">{variant.rawSku || "Not set"}</code></p></div>
              <div className="flex items-start justify-center pt-1"><span className={`rounded-full px-2 py-0.5 text-xs ${variant.state === "linked" ? "bg-emerald-100 text-emerald-800" : variant.state === "draft" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}>{variant.state === "linked" ? "Linked" : variant.state === "draft" ? "Draft" : "Unlinked"}</span></div>
              <div className="min-w-0">{editing ? <div className="flex gap-2"><Input list="sitegiant-isku-options" autoFocus value={assignments[candidate.id] ?? variant.proposedSalesSku?.code ?? ""} onChange={(event) => setAssignments((current) => ({ ...current, [candidate.id]: event.target.value }))} placeholder="Search Sitegiant iSKU" /><Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Done</Button></div> : sku ? <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{sku.name}</p><p className="mt-0.5 text-xs text-muted-foreground">Sitegiant iSKU: <code className="text-foreground">{sku.code}</code></p>{recipe && <p className="mt-1 text-xs text-primary">Kit recipe: {recipe}</p>}</div>{candidate && canMutate && <Button size="sm" variant="ghost" onClick={() => setEditingId(candidate.id)}>Change</Button>}</div> : canMutate && candidate ? <Button size="sm" variant="outline" onClick={() => setEditingId(candidate.id)}>Search Sitegiant iSKU</Button> : <p className="text-sm text-muted-foreground">No linked iSKU</p>}</div>
            </div>;
          })}
        </section>;
      })}
      {!data.rows.length && <p className="p-10 text-center text-sm text-muted-foreground">No listings in this view.</p>}
    </section>
    <div className="flex items-center justify-between px-1 text-sm text-muted-foreground"><span>{data.pagination.totalParents} products · page {data.pagination.page} of {data.pagination.totalPages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={data.pagination.page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="h-4 w-4" />Previous</Button><Button size="sm" variant="outline" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight className="h-4 w-4" /></Button></div></div>
  </div>;
}
