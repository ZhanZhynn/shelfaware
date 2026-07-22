"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePurchaseOrder, useShipPurchaseOrder, useUpdateShippingInfo, useUpdatePONotes } from "@/hooks/queries/use-purchase-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Truck, Package, FileText } from "lucide-react";
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
  received: "bg-emerald-500/15 text-emerald-700",
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

export default function SourcingPurchaseOrderDetail({ id }: { id: string }) {
  const [mounted, setMounted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [estimatedDelivery, setEstimatedDelivery] = useState("");
  const [shippingNotes, setShippingNotes] = useState("");
  useEffect(() => { setMounted(true); }, []);

  const { data: order, isLoading, error } = usePurchaseOrder(id);
  const shipMutation = useShipPurchaseOrder();
  const updateShippingMutation = useUpdateShippingInfo();
  const updateNotesMutation = useUpdatePONotes();

  useEffect(() => {
    if (order) {
      setNotes(order.notes || "");
      setTrackingCarrier(order.trackingCarrier || "");
      setTrackingNumber(order.trackingNumber || "");
      setTrackingUrl(order.trackingUrl || "");
      setEstimatedDelivery(order.estimatedDelivery ? new Date(order.estimatedDelivery).toISOString().slice(0, 10) : "");
      setShippingNotes(order.shippingNotes || "");
    }
  }, [order]);

  if (!mounted || isLoading) {
    return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6"><div className="h-64 animate-pulse rounded-xl bg-muted" /></main>;
  }

  if (error || !order) {
    return <main className="p-6 text-destructive">Unable to load this purchase order.</main>;
  }

  const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString() : "—";

  const handleShip = async () => {
    await shipMutation.mutateAsync({
      id: order.id,
      trackingCarrier: trackingCarrier.trim() || undefined,
      trackingNumber: trackingNumber.trim() || undefined,
      trackingUrl: trackingUrl.trim() || undefined,
      estimatedDelivery: estimatedDelivery || undefined,
      shippingNotes: shippingNotes.trim() || undefined,
    });
    setEditing(false);
  };

  const handleUpdateShipping = async () => {
    await updateShippingMutation.mutateAsync({
      id: order.id,
      trackingCarrier: trackingCarrier.trim() || undefined,
      trackingNumber: trackingNumber.trim() || undefined,
      trackingUrl: trackingUrl.trim() || undefined,
      estimatedDelivery: estimatedDelivery || undefined,
      shippingNotes: shippingNotes.trim() || undefined,
    });
    setEditing(false);
  };

  const canShip = order.status === "ordered";
  const canEditShipping = order.status === "shipped";
  const canEditNotes = ["ordered", "shipped"].includes(order.status);
  const showShippingForm = (canShip || canEditShipping) && editing;
  const isPending = shipMutation.isPending || updateShippingMutation.isPending || updateNotesMutation.isPending;

  const handleUpdateNotes = async () => {
    await updateNotesMutation.mutateAsync({ id: order.id, notes: notes.trim() });
    setEditingNotes(false);
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Link href="/sourcing" className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline">
        <ArrowLeft className="h-4 w-4" />Back to sourcing
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
          <p><b>Ordered:</b> {formatDate(order.orderedAt)}</p>
          {order.shippedAt && <p><b>Shipped:</b> {formatDate(order.shippedAt)}</p>}
          {order.receivedAt && <p><b>Received:</b> {formatDate(order.receivedAt)}</p>}
        </CardContent>
      </Card>

      {canEditNotes && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Notes</CardTitle>
            {!editingNotes && (
              <Button variant="outline" size="sm" onClick={() => setEditingNotes(true)}>Edit</Button>
            )}
          </CardHeader>
          <CardContent>
            {editingNotes ? (
              <div className="grid gap-4">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes about this order..." rows={3} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setEditingNotes(false); setNotes(order.notes || ""); }} disabled={isPending}>Cancel</Button>
                  <Button onClick={handleUpdateNotes} isLoading={isPending}>Save Notes</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{order.notes || "No notes yet."}</p>
            )}
          </CardContent>
        </Card>
      )}

      {((order.trackingNumber || order.trackingCarrier || order.shippedAt) && !editing) && (
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

      {(canShip || canEditShipping) && !editing && (
        <Card>
          <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
          <CardContent>
            <Button onClick={() => setEditing(true)}>
              <Truck className="h-4 w-4 mr-2" />{canShip ? "Mark as Shipped" : "Update Tracking"}
            </Button>
          </CardContent>
        </Card>
      )}

      {showShippingForm && (
        <Card>
          <CardHeader><CardTitle>{canShip ? "Mark as Shipped" : "Update Shipping Info"}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              Carrier
              <Input value={trackingCarrier} onChange={(e) => setTrackingCarrier(e.target.value)} placeholder="e.g. DHL, FedEx, SF Express" />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Tracking Number
              <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="Tracking number" />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Tracking URL
              <Input value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://..." />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Estimated Delivery
              <Input type="date" value={estimatedDelivery} onChange={(e) => setEstimatedDelivery(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-medium sm:col-span-2">
              Shipping Notes
              <Textarea value={shippingNotes} onChange={(e) => setShippingNotes(e.target.value)} placeholder="Additional notes about the shipment" />
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="outline" onClick={() => setEditing(false)} disabled={isPending}>Cancel</Button>
              <Button onClick={canShip ? handleShip : handleUpdateShipping} isLoading={isPending}>
                {canShip ? "Mark as Shipped" : "Update Tracking"}
              </Button>
            </div>
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
