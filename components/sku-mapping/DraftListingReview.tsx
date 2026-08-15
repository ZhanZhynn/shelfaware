"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type SalesSku = { id: string; code: string; name: string; family: { name: string }; recipe?: { quantity: number; sku: string; name: string }[] };
type Variant = { name: string; rawSku: string; candidate: { id: string }; draftSalesSku: SalesSku };
type Row = { shop: { name: string }; listing: { itemId: string; name: string; imageUrl: string | null }; variants: Variant[] };
type Data = { rows: Row[]; pagination: { page: number; totalParents: number; totalPages: number }; counts: { draft: number } };
type ConfirmationRun = { id: string; status: "running" | "completed" | "completed_with_errors"; totalCount: number; processedCount: number; confirmedCount: number; skippedCount: number; errorCount: number; errors: { candidateId: string; error: string }[] | null };

function recipeSummary(sku: SalesSku) {
  const components = sku.recipe ?? [];
  if (components.length === 1 && components[0]?.sku === sku.code && components[0]?.quantity === 1) return null;
  return components.length ? components.map((component) => `${component.quantity} x ${component.sku}`).join(" + ") : null;
}

export default function DraftListingReview() {
  const client = useQueryClient();
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<{ candidateId: string; mappingId?: string; error?: string }[]>([]);
  const [run, setRun] = useState<ConfirmationRun | null>(null);
  const query = useQuery({
    queryKey: ["skuMapping", "draft-review", submittedSearch, page],
    enabled: hydrated,
    queryFn: async () => (await axios.get("/api/inventory/sku-mapping/review", { params: { state: "draft", search: submittedSearch, page }, withCredentials: true })).data as Data,
  });
  if (!hydrated || query.isLoading) return <div className="mx-auto h-72 max-w-5xl animate-pulse rounded-xl bg-muted" />;
  if (!query.data) return <p className="text-destructive">Could not load draft listings.</p>;
  const data = query.data;
  const removeDraft = async (candidateId: string) => {
    await axios.post("/api/inventory/sku-mapping/review", { command: "remove-draft", candidateId }, { withCredentials: true });
    await client.invalidateQueries({ queryKey: ["skuMapping"] });
  };
  const processRun = async (runId: string) => {
    try {
      const response = await axios.post("/api/inventory/sku-mapping/review", { command: "process-confirmation-run", runId }, { withCredentials: true });
      const next = response.data as ConfirmationRun;
      setRun(next);
      if (next.status === "running") {
        window.setTimeout(() => { void processRun(runId); }, 250);
        return;
      }
      confirmingRef.current = false;
      setConfirming(false);
      setMessage(`${next.confirmedCount} link${next.confirmedCount === 1 ? "" : "s"} confirmed${next.errorCount ? `; ${next.errorCount} need attention.` : "."}`);
      setOutcomes((next.errors ?? []).map((error) => ({ candidateId: error.candidateId, error: error.error })));
      await client.invalidateQueries({ queryKey: ["skuMapping"] });
    } catch (error) {
      confirmingRef.current = false;
      setConfirming(false);
      setMessage(axios.isAxiosError(error) ? error.response?.data?.error ?? "Confirmation run failed." : "Confirmation run failed.");
    }
  };
  const confirmAll = async () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true); setMessage(null); setOutcomes([]); setRun(null);
    try {
      const response = await axios.post("/api/inventory/sku-mapping/review", { command: "start-confirmation-run" }, { withCredentials: true });
      const started = response.data as ConfirmationRun;
      setRun(started);
      await processRun(started.id);
    } catch (error) {
      setMessage(axios.isAxiosError(error) ? error.response?.data?.error ?? "Could not confirm draft listings." : "Could not confirm draft listings.");
      confirmingRef.current = false;
      setConfirming(false);
    }
  };
  return <div className="mx-auto max-w-5xl space-y-5 px-3 pb-10 sm:px-6">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 pt-1">
      <a href="/admin/inventory/sku-mapping" className="inline-flex items-center gap-2 text-sm font-medium hover:text-primary"><ArrowLeft className="h-4 w-4" />Inventory Linking</a>
      <Button disabled={!data.counts.draft} onClick={() => setConfirmOpen(true)}>{`Confirm and Save Links (${data.counts.draft})`}</Button>
    </header>
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <h1 className="text-lg font-semibold">Review Draft Listing</h1>
      <p className="mt-1 text-sm text-muted-foreground">Review every Shopee SKU and its selected Sitegiant iSKU before confirming the links.</p>
      <form className="mt-5 flex max-w-xl gap-2" onSubmit={(event) => { event.preventDefault(); setSubmittedSearch(search); setPage(1); }}><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product name, Shopee SKU, or iSKU" /><Button type="submit" size="sm" variant="outline"><Search className="mr-2 h-4 w-4" />Search</Button></form>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)] border-y bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-4"><span>Channel Listing</span><span className="text-center">Draft Listing</span><span>Sitegiant Inventory</span></div>
      {data.rows.map((row) => row.variants.map((variant) => <div key={variant.candidate.id} className="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)] items-center gap-3 border-b px-3 py-4 last:border-0 sm:px-4">
        <div className="flex min-w-0 gap-3"><div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">{row.listing.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- marketplace image hosts are dynamic and not Next Image configured.
          <img src={row.listing.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        )}</div><div className="min-w-0"><p className="line-clamp-2 text-sm font-medium">{row.listing.name}</p><p className="mt-1 text-xs text-muted-foreground">{row.shop.name} · {variant.name}</p><p className="mt-0.5 text-xs text-muted-foreground">Shopee SKU: <code className="text-foreground">{variant.rawSku || "Not set"}</code></p></div></div>
        <div className="text-center text-xs font-medium text-emerald-700">To be linked</div>
        <div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><p className="line-clamp-2 text-sm font-medium">{variant.draftSalesSku.name}</p><p className="mt-1 text-xs text-muted-foreground">Sitegiant iSKU: <code className="text-foreground">{variant.draftSalesSku.code}</code></p>{recipeSummary(variant.draftSalesSku) && <p className="mt-1 text-xs text-primary">Kit recipe: {recipeSummary(variant.draftSalesSku)}</p>}</div><Button size="sm" variant="ghost" className="shrink-0" onClick={() => removeDraft(variant.candidate.id)}>Remove</Button></div>
      </div>))}
      {!data.rows.length && <p className="py-12 text-center text-sm text-muted-foreground">No draft listings are ready for review.</p>}
    </section>
    <div className="flex items-center justify-between px-1 text-sm text-muted-foreground"><span>{data.pagination.totalParents} products · page {data.pagination.page} of {data.pagination.totalPages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={data.pagination.page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="h-4 w-4" />Previous</Button><Button size="sm" variant="outline" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight className="h-4 w-4" /></Button></div></div>
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent><DialogHeader><DialogTitle>Confirm and save draft links</DialogTitle><DialogDescription>Links are saved in small batches so you can see progress. Any conflicting link stays in draft for correction.</DialogDescription></DialogHeader>{run && <div className="space-y-2 rounded border bg-muted/30 p-3"><div className="flex justify-between text-sm"><span>Processing {run.processedCount} of {run.totalCount}</span><strong>{run.confirmedCount} confirmed</strong></div><progress className="h-2 w-full accent-primary" value={run.processedCount} max={run.totalCount} /><p className="text-xs text-muted-foreground">{run.errorCount ? `${run.errorCount} need attention` : `${Math.max(0, run.totalCount - run.processedCount)} remaining`}</p></div>}{message && <p className="text-sm">{message}</p>}{outcomes.some((outcome) => outcome.error) && <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{outcomes.filter((outcome) => outcome.error).map((outcome) => <p key={outcome.candidateId}>{outcome.error}</p>)}</div>}<DialogFooter><Button variant="outline" onClick={() => setConfirmOpen(false)}>{confirming ? "Hide" : "Close"}</Button><Button disabled={confirming} onClick={confirmAll}>{confirming ? "Confirming…" : "Confirm and Save Links"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
