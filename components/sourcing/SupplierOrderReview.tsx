"use client";
/* eslint-disable @next/next/no-img-element -- sourcing attachments require authenticated URLs. */

import Link from "next/link";
import { ArrowLeft, Check, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSourcingCase, useSourcingCommand } from "@/hooks/queries";

const label = (variant: any) =>
  variant.customLabel ||
  [variant.size, variant.material, variant.colour]
    .filter(Boolean)
    .join(" / ") ||
  "Standard";

export default function SupplierOrderReview({
  caseId,
}: {
  caseId: string;
}) {
  const { data: item, isLoading, error } = useSourcingCase(caseId);
  const command = useSourcingCommand();

  if (isLoading)
    return (
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </main>
    );
  if (error || !item)
    return (
      <main className="p-6 text-destructive">
        Unable to load sourcing request.
      </main>
    );

  const reviewable = ["approved", "order_pending"].includes(item.stage);
  const submittedLines = item.quotes.flatMap((quote: any) =>
    ["submitted", "changes_requested"].includes(quote.status)
      ? quote.lines.map((line: any) => ({ ...line, quote }))
      : [],
  );
  const selectedVariantIds = new Set(
    item.variants
      .filter((variant: any) => variant.selection?.status === "selected")
      .map((variant: any) => variant.id),
  );
  const selectedOfferLines: any[] = submittedLines.filter((line: any) =>
    selectedVariantIds.has(line.caseVariantId),
  );
  const selectedBySupplier = selectedOfferLines.reduce<Record<string, any[]>>(
    (groups, line: any) => {
      (groups[line.quote.supplierName] ||= []).push(line);
      return groups;
    },
    {},
  );
  const createdQuoteIds = new Set(
    item.orders.map((order: any) => order.quoteId),
  );
  const variantAttachments = (item.attachments || []).filter(
    (attachment: any) => attachment.caseVariantId,
  );
  const skippedCount = item.variants.filter(
    (variant: any) => variant.selection?.status === "skipped",
  ).length;
  const allCreated =
    reviewable &&
    Object.values(selectedBySupplier).every(
      (lines) => lines.length && createdQuoteIds.has(lines[0]?.quoteId),
    );

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline"
            href={`/admin/sourcing/${item.id}`}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to request
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{item.title}</h1>
          <p className="mt-1 text-muted-foreground">
            Final supplier order review
          </p>
        </div>
        <Badge className="capitalize">
          {item.stage.replaceAll("_", " ")}
        </Badge>
      </div>

      {allCreated ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">
                  All supplier orders have been created
                </p>
                <p className="text-sm text-muted-foreground">
                  The sourcer can now place each supplier order and arrange
                  shipment.
                </p>
              </div>
            </div>
            <Button asChild>
              <Link href={`/admin/sourcing/${item.id}`}>Back to request</Link>
            </Button>
          </CardContent>
        </Card>
      ) : !reviewable ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            This request is not awaiting supplier order creation.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Supplier orders</CardTitle>
            <p className="text-sm text-muted-foreground">
              Create one supplier order at a time, or create all remaining
              supplier orders together. Payment is arranged directly with each
              supplier.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(selectedBySupplier).map(
              ([supplier, supplierLines]) => {
                const lines = supplierLines as any[];
                const quoteId = lines[0]?.quoteId;
                const alreadyCreated = createdQuoteIds.has(quoteId);
                const units = lines.reduce(
                  (total, line) =>
                    total + Math.max(line.requestedQuantity, line.moq || 0),
                  0,
                );
                const total = lines.reduce(
                  (sum, line) =>
                    sum +
                    Math.max(line.requestedQuantity, line.moq || 0) *
                      (line.unitPriceRmb || 0),
                  0,
                );
                return (
                  <div
                    key={supplier}
                    className="overflow-hidden rounded-md border"
                  >
                    <div className="flex flex-wrap items-center gap-3 bg-muted/50 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {supplier}
                          <span className="ml-2 font-normal text-muted-foreground">
                            1 PO · {lines.length} product
                            {lines.length === 1 ? "" : "s"} ·{" "}
                            {units.toLocaleString()} units
                          </span>
                        </p>
                      </div>
                      <span className="font-medium">
                        CNY {total.toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                      {item.title}
                    </div>
                    <div className="divide-y">
                      {lines.map((line: any) => {
                        const image = variantAttachments.find(
                          (attachment: any) =>
                            attachment.caseVariantId === line.caseVariantId,
                        );
                        const quantity = Math.max(
                          line.requestedQuantity,
                          line.moq || 0,
                        );
                        return (
                          <div
                            key={line.id}
                            className="grid grid-cols-[minmax(220px,1fr)_110px_130px_120px] gap-3 px-4 py-3 text-sm"
                          >
                            <div className="flex min-w-0 gap-3">
                              {image ? (
                                <img
                                  src={image.url}
                                  alt={label(line)}
                                  className="h-12 w-12 shrink-0 rounded border object-cover"
                                />
                              ) : (
                                <div className="h-12 w-12 shrink-0 rounded border bg-muted" />
                              )}
                              <div className="min-w-0">
                                <p className="font-medium">{label(line)}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  CNY {line.unitPriceRmb || 0} each
                                </p>
                              </div>
                            </div>
                            <span className="pt-1">
                              x{quantity.toLocaleString()}
                            </span>
                            <span className="pt-1">
                              CNY{" "}
                              {(
                                quantity * (line.unitPriceRmb || 0)
                              ).toLocaleString()}
                            </span>
                            <span />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-end border-t px-4 py-2">
                      <Button
                        size="sm"
                        variant="link"
                        disabled={alreadyCreated}
                        isLoading={command.isPending}
                        onClick={() =>
                          command.mutate({
                            id: item.id,
                            action: "create_variant_orders",
                            version: item.version,
                            quoteId,
                          })
                        }
                      >
                        {alreadyCreated ? "Order created" : "Create order"}
                      </Button>
                    </div>
                  </div>
                );
              },
            )}
            {skippedCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {skippedCount} variant{skippedCount === 1 ? "" : "s"}{" "}
                deliberately skipped.
              </p>
            )}
            <Button
              onClick={() =>
                command.mutate({
                  id: item.id,
                  action: "create_variant_orders",
                  version: item.version,
                })
              }
              isLoading={command.isPending}
            >
              <PackagePlus className="h-4 w-4" /> Create all supplier orders
            </Button>
          </CardContent>
        </Card>
      )}

      {item.orders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Purchase orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {item.orders.map((order: any) => (
              <Link
                key={order.id}
                className="block rounded border p-3 hover:bg-muted/50"
                href={`/admin/purchase-orders/${order.purchaseOrderId}`}
              >
                {order.purchaseOrder?.poNumber} ·{" "}
                {order.purchaseOrder?.supplier?.name} ·{" "}
                {order.purchaseOrder?.items?.length} variant lines
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
