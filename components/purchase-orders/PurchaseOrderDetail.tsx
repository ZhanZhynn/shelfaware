"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePurchaseOrder, useApprovePurchaseOrder, useDeletePurchaseOrder } from "@/hooks/queries/use-purchase-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CheckCircle, XCircle, Trash2, Package, Truck } from "lucide-react";
import type { PurchaseOrder, PurchaseOrderItem } from "@/types/purchase-order";

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/15 text-gray-700",
  pending_approval: "bg-amber-500/15 text-amber-700",
  approved: "bg-emerald-500/15 text-emerald-700",
  rejected: "bg-red-500/15 text-red-700",
  ordered: "bg-blue-500/15 text-blue-700",
  shipped: "bg-violet-500/15 text-violet-700",
  received: "bg-violet-500/15 text-violet-700",
  cancelled: "bg-gray-500/15 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  ordered: "Ordered",
  shipped: "Shipped",
  received: "Received",
  cancelled: "Cancelled",
};

export default function PurchaseOrderDetail({ id }: { id: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const { data: order, isLoading, error } = usePurchaseOrder(id);
  const approveMutation = useApprovePurchaseOrder();
  const deleteMutation = useDeletePurchaseOrder();

  if (!mounted || isLoading) {
    return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6"><div className="h-64 animate-pulse rounded-xl bg-muted" /></main>;
  }

  if (error || !order) {
    return <main className="p-6 text-destructive">Unable to load this purchase order.</main>;
  }

  const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString() : "—";

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Link href="/admin/purchase-orders" className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline">
        <ArrowLeft className="h-4 w-4" />Back to purchase orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{order.poNumber}</h1>
          <p className="text-muted-foreground">{order.supplierName || "Unknown supplier"}</p>
        </div>
        <Badge className={STATUS_COLORS[order.status] || ""}>{STATUS_LABELS[order.status] || order.status}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <p><b>Supplier:</b> {order.supplierName || "—"}</p>
          <p><b>Total:</b> {formatCurrency(order.totalAmount)}</p>
          <p><b>Created:</b> {formatDate(order.createdAt)}</p>
          <p><b>Approved:</b> {formatDate(order.approvedAt)}</p>
          <p><b>Ordered:</b> {formatDate(order.orderedAt)}</p>
          {order.shippedAt && <p><b>Shipped:</b> {formatDate(order.shippedAt)}</p>}
          {order.receivedAt && <p><b>Received:</b> {formatDate(order.receivedAt)}</p>}
          {order.notes && <p className="sm:col-span-2"><b>Notes:</b> {order.notes}</p>}
        </CardContent>
      </Card>

      {(order.trackingNumber || order.trackingCarrier || order.shippedAt) && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" />Shipping Info</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            {order.trackingCarrier && <p><b>Carrier:</b> {order.trackingCarrier}</p>}
            {order.trackingNumber && <p><b>Tracking #:</b> {order.trackingNumber}</p>}
            {order.trackingUrl && (
              <p><b>Tracking URL:</b> <a className="text-sky-600 underline" href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Open</a></p>
            )}
            {order.estimatedDelivery && <p><b>Est. delivery:</b> {formatDate(order.estimatedDelivery)}</p>}
            {order.shippingNotes && <p className="sm:col-span-2"><b>Shipping notes:</b> {order.shippingNotes}</p>}
          </CardContent>
        </Card>
      )}

      {order.status === "pending_approval" && (
        <Card>
          <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button className="bg-green-600 text-white hover:bg-green-700" onClick={() => approveMutation.mutate({ id: order.id, action: "approve" })} disabled={approveMutation.isPending}>
              <CheckCircle className="h-4 w-4" />Approve
            </Button>
            <Button variant="destructive" onClick={() => approveMutation.mutate({ id: order.id, action: "reject" })} disabled={approveMutation.isPending}>
              <XCircle className="h-4 w-4" />Reject
            </Button>
          </CardContent>
        </Card>
      )}

      {["draft", "pending_approval"].includes(order.status) && (
        <Card>
          <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => { if (confirm("Cancel this purchase order?")) deleteMutation.mutate(order.id); }} disabled={deleteMutation.isPending}>
              <Trash2 className="h-4 w-4" />Cancel order
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <CardContent>
          {order.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase text-muted-foreground md:grid">
                <span>Product</span>
                <span>SKU</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Unit cost</span>
                <span className="text-right">Subtotal</span>
              </div>
              {order.items.map((item: PurchaseOrderItem) => (
                <div key={item.id} className="grid gap-2 border-b px-4 py-3 last:border-0 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
                  <span className="font-medium">{item.productName}</span>
                  <span className="text-muted-foreground">{item.sku || "—"}</span>
                  <span className="text-right">{item.quantity}</span>
                  <span className="text-right">{formatCurrency(item.unitCost)}</span>
                  <span className="text-right font-medium">{formatCurrency(item.subtotal)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
