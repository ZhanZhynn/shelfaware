"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useShipPurchaseOrder, useUpdateShippingInfo, useUpdatePONotes } from "@/hooks/queries/use-purchase-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, FileText, ExternalLink } from "lucide-react";
import { formatMoney } from "@/lib/money";

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

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

interface PO {
  id: string;
  poNumber: string;
  status: string;
  totalAmount: number;
  currency?: string;
  myrEstimate?: number;
  estimateKind?: "locked" | "current";
  estimateRate?: number;
  estimateRateDate?: string;
  estimateProvider?: string;
  notes?: string;
  trackingNumber?: string;
  trackingCarrier?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  shippingNotes?: string;
  shippedAt?: string;
  orderedAt?: string;
  createdAt: string;
  supplier?: { id: string; name: string };
  items: { id: string; productName: string; sku?: string; quantity: number; unitCost: number; subtotal: number }[];
}

interface OrderLink {
  purchaseOrder?: PO;
}

export default function SourcingPurchaseOrderPanel({ orders, basePath = "/sourcing" }: { orders: OrderLink[]; basePath?: string }) {
  const [selectedId, setSelectedId] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [editingTracking, setEditingTracking] = useState(false);
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [estimatedDelivery, setEstimatedDelivery] = useState("");
  const [shippingNotes, setShippingNotes] = useState("");

  const shipMutation = useShipPurchaseOrder();
  const updateShippingMutation = useUpdateShippingInfo();
  const updateNotesMutation = useUpdatePONotes();

  const pos = orders.map((o) => o.purchaseOrder).filter(Boolean) as PO[];

  useEffect(() => {
    if (pos.length === 1 && !selectedId) setSelectedId(pos[0]!.id);
    if (pos.length > 0 && !pos.find((p) => p.id === selectedId)) setSelectedId(pos[0]!.id);
  }, [pos, selectedId]);

  const selected = pos.find((p) => p.id === selectedId);

  useEffect(() => {
    if (selected) {
      setNotes(selected.notes || "");
      setTrackingCarrier(selected.trackingCarrier || "");
      setTrackingNumber(selected.trackingNumber || "");
      setTrackingUrl(selected.trackingUrl || "");
      setEstimatedDelivery(selected.estimatedDelivery ? new Date(selected.estimatedDelivery).toISOString().slice(0, 10) : "");
      setShippingNotes(selected.shippingNotes || "");
      setEditingNotes(false);
      setEditingTracking(false);
    }
  }, [selected]);

  if (pos.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Purchase order</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No purchase order linked.</p>
        </CardContent>
      </Card>
    );
  }

  const isPending = shipMutation.isPending || updateShippingMutation.isPending || updateNotesMutation.isPending;
  const poDetailBase = basePath.startsWith("/admin") ? "/admin/purchase-orders" : "/sourcing/purchase-orders";

  const handleShip = async () => {
    if (!selected) return;
    await shipMutation.mutateAsync({
      id: selected.id,
      trackingCarrier: trackingCarrier.trim() || undefined,
      trackingNumber: trackingNumber.trim() || undefined,
      trackingUrl: trackingUrl.trim() || undefined,
      estimatedDelivery: estimatedDelivery || undefined,
      shippingNotes: shippingNotes.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setEditingTracking(false);
  };

  const handleUpdateTracking = async () => {
    if (!selected) return;
    await updateShippingMutation.mutateAsync({
      id: selected.id,
      trackingCarrier: trackingCarrier.trim() || undefined,
      trackingNumber: trackingNumber.trim() || undefined,
      trackingUrl: trackingUrl.trim() || undefined,
      estimatedDelivery: estimatedDelivery || undefined,
      shippingNotes: shippingNotes.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setEditingTracking(false);
  };

  const handleUpdateNotes = async () => {
    if (!selected) return;
    await updateNotesMutation.mutateAsync({ id: selected.id, notes: notes.trim() });
    setEditingNotes(false);
  };

  const canShip = selected?.status === "ordered";
  const canEditTracking = selected?.status === "shipped";
  const canEditNotes = selected && ["ordered", "shipped"].includes(selected.status);
  const showTrackingForm = (canShip || canEditTracking) && editingTracking;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Purchase order</CardTitle>
        {pos.length > 1 && (
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select PO" /></SelectTrigger>
            <SelectContent>
              {pos.map((po) => (
                <SelectItem key={po.id} value={po.id}>{po.poNumber} ({po.status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {selected && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`${poDetailBase}/${selected.id}`} className="text-sky-600 underline font-medium">{selected.poNumber}</Link>
              <Badge className={STATUS_COLORS[selected.status] || ""}>{STATUS_LABELS[selected.status] || selected.status}</Badge>
              <span className="text-sm text-muted-foreground">{selected.supplier?.name || "—"}</span>
               <span className="text-sm text-muted-foreground">{formatMoney(selected.totalAmount, selected.currency || "MYR")}</span>
            </div>

             <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p><b>Created:</b> {formatDate(selected.createdAt)}</p>
              {selected.orderedAt && <p><b>Ordered:</b> {formatDate(selected.orderedAt)}</p>}
              {selected.shippedAt && <p><b>Shipped:</b> {formatDate(selected.shippedAt)}</p>}
             </div>

             {selected.myrEstimate != null && selected.currency === "CNY" && (
               <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
                 <p className="font-medium">Estimated in MYR</p>
                 <p className="mt-1 text-lg font-semibold">{formatMoney(selected.myrEstimate, "MYR")}</p>
                 <p className="mt-1 text-muted-foreground">
                   1 CNY = {selected.estimateRate?.toFixed(5)} MYR
                   {selected.estimateRateDate ? ` · Rate date: ${formatDate(selected.estimateRateDate)}` : ""}
                 </p>
                 <p className="text-xs text-muted-foreground">
                   {selected.estimateKind === "locked" ? "Locked at quote approval." : "Latest daily estimate; supplier purchase order remains denominated in CNY."}
                 </p>
               </div>
             )}

            {(selected.trackingNumber || selected.trackingCarrier || selected.shippedAt) && !editingTracking && (
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <p className="font-medium flex items-center gap-2"><Truck className="h-4 w-4" />Shipping Info</p>
                {selected.trackingCarrier && <p><b>Carrier:</b> {selected.trackingCarrier}</p>}
                {selected.trackingNumber && <p><b>Tracking #:</b> {selected.trackingNumber}</p>}
                {selected.trackingUrl && <p><b>URL:</b> <a className="text-sky-600 underline" href={selected.trackingUrl} target="_blank" rel="noopener noreferrer">Open</a></p>}
                {selected.estimatedDelivery && <p><b>Est. delivery:</b> {formatDate(selected.estimatedDelivery)}</p>}
                {selected.shippingNotes && <p><b>Shipping notes:</b> {selected.shippingNotes}</p>}
              </div>
            )}

            {canEditNotes && !editingNotes && !editingTracking && (
              <div className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium flex items-center gap-2"><FileText className="h-4 w-4" />Notes</p>
                  <Button variant="ghost" size="sm" onClick={() => setEditingNotes(true)}>Edit</Button>
                </div>
                <p className="text-muted-foreground">{selected.notes || "No notes."}</p>
              </div>
            )}

            {canEditNotes && editingNotes && !editingTracking && (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="font-medium text-sm flex items-center gap-2"><FileText className="h-4 w-4" />Notes</p>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes..." rows={3} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setEditingNotes(false); setNotes(selected.notes || ""); }} disabled={isPending}>Cancel</Button>
                  <Button size="sm" onClick={handleUpdateNotes} isLoading={isPending}>Save</Button>
                </div>
              </div>
            )}

            {showTrackingForm && (
              <div className="rounded-lg border p-3 space-y-3">
                <p className="font-medium text-sm">{canShip ? "Mark as Shipped" : "Update Tracking"}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-medium">
                    Carrier
                    <Input value={trackingCarrier} onChange={(e) => setTrackingCarrier(e.target.value)} placeholder="e.g. DHL, SF Express" />
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
                    Est. Delivery
                    <Input type="date" value={estimatedDelivery} onChange={(e) => setEstimatedDelivery(e.target.value)} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium sm:col-span-2">
                    Shipping Notes
                    <Textarea value={shippingNotes} onChange={(e) => setShippingNotes(e.target.value)} placeholder="Shipment notes" rows={2} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium sm:col-span-2">
                    Order Notes
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="General notes" rows={2} />
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingTracking(false)} disabled={isPending}>Cancel</Button>
                  <Button size="sm" onClick={canShip ? handleShip : handleUpdateTracking} isLoading={isPending}>
                    {canShip ? "Mark as Shipped" : "Update Tracking"}
                  </Button>
                </div>
              </div>
            )}

            {(canShip || canEditTracking) && !editingTracking && !editingNotes && (
              <Button size="sm" variant="outline" onClick={() => setEditingTracking(true)}>
                <Truck className="h-4 w-4 mr-2" />{canShip ? "Mark as Shipped" : "Update Tracking"}
              </Button>
            )}

            {selected.items.length > 0 && (
              <div className="overflow-hidden rounded-xl border text-sm">
                <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium uppercase text-muted-foreground md:grid">
                  <span>Product</span><span>SKU</span><span className="text-right">Qty</span><span className="text-right">Unit cost</span><span className="text-right">Subtotal</span>
                </div>
                {selected.items.map((item) => (
                  <div key={item.id} className="grid gap-2 border-b px-4 py-2 last:border-0 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
                    <span className="font-medium">{item.productName}</span>
                    <span className="text-muted-foreground">{item.sku || "—"}</span>
                    <span className="text-right">{item.quantity}</span>
                     <span className="text-right">{formatMoney(item.unitCost, selected.currency || "MYR")}</span>
                     <span className="text-right font-medium">{formatMoney(item.subtotal, selected.currency || "MYR")}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
