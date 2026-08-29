"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { getSourcingStageBadgeVariant } from "@/lib/sourcing/presentation";

export function SourcingRequestRow({
  item,
  href,
  accentClass,
  status,
  statusMessage,
  action,
  fulfillmentSummary,
  mode = "tracking",
}: {
  item: any;
  href: string;
  accentClass: string;
  status?: string;
  statusMessage: string;
  action: ReactNode;
  fulfillmentSummary?: string | null;
  mode?: "work" | "tracking";
}) {
  return (
    <div className={`overflow-hidden rounded-md border border-l-4 ${accentClass} bg-card`}>
      <SourcingRequestHeader item={item} />
      <div className={`grid gap-3 p-3 ${mode === "tracking" ? "grid-cols-[minmax(260px,1fr)_140px_130px_110px]" : "grid-cols-[minmax(260px,1fr)_150px]"}`}>
        <div className="flex min-w-0 items-start gap-3">
          {item.thumbnail && (
            // Authenticated attachment URLs cannot use next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnail.url}
              alt={item.thumbnail.fileName || "Case reference"}
              className="h-14 w-14 shrink-0 rounded-md border object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <Link href={href} className="font-semibold hover:text-sky-600 hover:underline">
              {item.title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {item.updatedAt
                ? new Date(item.updatedAt).toLocaleDateString()
                : new Date(item.createdAt).toLocaleDateString()}
              {" · "}{statusMessage}
            </p>
            {fulfillmentSummary && <p className="mt-1 text-xs text-muted-foreground">{fulfillmentSummary}</p>}
          </div>
        </div>
        {mode === "tracking" && (
          <div className="pt-1 text-sm text-muted-foreground">
            {item.assignee?.name || item.assignee?.email || "Unassigned"}
          </div>
        )}
        {mode === "tracking" && status && (
          <div className="pt-1">
            <Badge variant={getSourcingStageBadgeVariant(status)} className="capitalize">
              {status.replaceAll("_", " ")}
            </Badge>
          </div>
        )}
        <div className="self-center text-sm">{action}</div>
      </div>
    </div>
  );
}

export function SourcingRequestHeader({ item }: { item: any }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2">
        {item.requester?.image ? (
          // Authenticated profile images use the browser session.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.requester.image} alt="" className="h-5 w-5 rounded-full object-cover" />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background text-[10px] font-medium text-foreground">
            {(item.requester?.name || item.requester?.email || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="truncate">{item.requester?.name || item.requester?.email || "Unknown requester"}</span>
      </div>
      <span className="shrink-0" title={item.id}>Request ID {item.id}</span>
    </div>
  );
}
