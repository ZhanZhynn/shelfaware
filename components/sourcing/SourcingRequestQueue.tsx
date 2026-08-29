"use client";

import Link from "next/link";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { SourcingRequestRow } from "./SourcingRequestRow";

type QueueMode = "quotes" | "tracking";

const stageOrder = [
  "draft",
  "sourcing",
  "changes_requested",
  "quoted",
  "approved",
  "order_pending",
  "ordered",
  "shipping",
  "received",
];

const trackingGroup = (stage: string) => {
  if (["draft", "sourcing", "changes_requested"].includes(stage)) return "needs";
  if (stage === "quoted") return "waiting";
  if (["approved", "order_pending", "ordered", "shipping"].includes(stage)) return "fulfillment";
  if (stage === "received") return "completed";
  return "closed";
};

export function SourcingRequestQueue({
  cases,
  basePath,
  mode,
}: {
  cases: any[];
  basePath: string;
  mode: QueueMode;
}) {
  const [group, setGroup] = useState("all");
  const [stage, setStage] = useState("all");
  const [search, setSearch] = useState("");
  const quoteCases = cases.filter((item) =>
    ["sourcing", "changes_requested"].includes(item.stage),
  );
  const source = mode === "quotes" ? quoteCases : cases;
  const groupTabs = [
    ["all", "All"],
    ["needs", "Needs Sourcing"],
    ["waiting", "Waiting"],
    ["fulfillment", "In Fulfillment"],
    ["completed", "Completed"],
  ] as const;
  const groupCases = source.filter(
    (item) => mode === "quotes" || group === "all" || trackingGroup(item.stage) === group,
  );
  const stageCounts = groupCases.reduce<Record<string, number>>((acc, item) => {
    acc[item.stage] = (acc[item.stage] || 0) + 1;
    return acc;
  }, {});
  const visibleStages = stageOrder.filter((value) => stageCounts[value]);
  const filtered = groupCases.filter((item) => {
    const query = search.toLowerCase();
    return (
      (stage === "all" || item.stage === stage) &&
      (!query ||
        item.title.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query) ||
        `${item.requester?.name || ""} ${item.requester?.email || ""}`.toLowerCase().includes(query) ||
        `${item.assignee?.name || ""} ${item.assignee?.email || ""}`.toLowerCase().includes(query))
    );
  });

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b">
        <h2 className="mr-auto text-lg font-semibold">{mode === "quotes" ? "Quotes" : "Requests"}</h2>
        {mode === "tracking" && (
          <div className="flex flex-wrap gap-x-6">
            {groupTabs.map(([id, label]) => {
              const count = source.filter((item) => id === "all" || trackingGroup(item.stage) === id).length;
              return (
                <button key={id} type="button" onClick={() => { setGroup(id); setStage("all"); }} className={`border-b-2 px-1 pb-3 text-sm font-medium ${group === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {label} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
        <span className="mr-1 font-medium text-muted-foreground">Request status</span>
        {["all", ...visibleStages].map((value) => (
          <button key={value} type="button" onClick={() => setStage(value)} className={`rounded-full border px-3 py-1 text-sm ${stage === value ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}>
            {value === "all" ? "All" : value.replaceAll("_", " ")} ({value === "all" ? groupCases.length : stageCounts[value] || 0})
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center border-b pb-3">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} className="ml-auto min-w-[260px] max-w-md" placeholder="Title, requester, assignee, or request ID" />
      </div>
      <div className="grid grid-cols-[minmax(260px,1fr)_140px_130px_110px] gap-3 bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
        <span>Request</span><span>Assigned to</span><span>Status</span><span>Actions</span>
      </div>
      {filtered.length ? <div className="space-y-2">{filtered.map((item) => {
        const correction = item.stage === "changes_requested";
        const correctionQuote = (item.quotes || []).find((quote: any) => quote.status === "changes_requested");
        const quoteHref = `${basePath}/${item.id}${correctionQuote ? `?sheet=${correctionQuote.quoteGroupId || correctionQuote.id}` : ""}#supplier-quote-sheets`;
        const poStatuses = (item.orders || []).map((order: any) => order.purchaseOrder?.status).filter(Boolean);
        const poSummary = Object.entries(poStatuses.reduce((acc: Record<string, number>, value: string) => { acc[value] = (acc[value] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([value, count]) => `${count} ${value === "approved" ? "To Order" : value === "ordered" ? "To Ship" : value}`).join(" · ");
        const quoteAction = correction ? "Fix quote sheet" : "Open quote sheets";
        const href = mode === "quotes" ? quoteHref : `${basePath}/${item.id}`;
        return <SourcingRequestRow
          key={item.id}
          item={item}
          href={href}
          accentClass={correction ? "border-l-amber-500" : mode === "quotes" ? "border-l-orange-500" : "border-l-blue-500"}
          status={item.stage}
          statusMessage={mode === "quotes" ? (correction ? "Supplier quote needs correction" : "Collect and submit supplier offers") : item.stage === "shipping" ? "Shipped, awaiting receipt" : item.stage === "ordered" ? "Your action: arrange shipment" : item.stage.replaceAll("_", " ")}
          fulfillmentSummary={mode === "tracking" && poStatuses.length ? `${poStatuses.length} PO${poStatuses.length === 1 ? "" : "s"} · ${poSummary}` : null}
          action={<Link href={href} className="text-sky-600 hover:underline">{mode === "quotes" ? quoteAction : "View request"}</Link>}
        />;
      })}</div> : <p className="p-6 text-center text-sm text-muted-foreground">No requests found.</p>}
    </section>
  );
}
