"use client";

import Link from "next/link";
import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useBatchPlaceSupplierOrders,
  useSupplierOrders,
} from "@/hooks/queries";

type SupplierOrder = {
  id: string;
  poNumber: string;
  status: string;
  currency: string;
  totalAmount: number;
  supplierOrderReference?: string | null;
  supplierOrderPlacedAt?: string | null;
  supplier: { id: string; name: string };
  sourcingCase: { id: string; title: string; attachments: Array<{ url: string; fileName?: string | null }> };
  items: Array<{
    id: string;
    productName: string;
    sku?: string | null;
    quantity: number;
    unitCost: number;
    subtotal: number;
  }>;
};

const statusLabel = (status: string) => status.replaceAll("_", " ");
const statusVariant = (status: string) =>
  status === "approved"
    ? "warning"
    : status === "received"
      ? "success"
      : "info";

export function SupplierOrderQueue({
  workspaceId,
  basePath,
}: {
  workspaceId: string;
  basePath: string;
}) {
  const { data: orders = [], isLoading, error } = useSupplierOrders(workspaceId);
  const batchPlace = useBatchPlaceSupplierOrders();
  const [status, setStatus] = useState("approved");
  const [search, setSearch] = useState("");
  const [placingOrderId, setPlacingOrderId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const filtered = (orders as SupplierOrder[]).filter((order) => {
    const matchesStatus = status === "all" || order.status === status;
    const query = search.toLowerCase();
    const matchesSearch =
      !query ||
      order.supplier.name.toLowerCase().includes(query) ||
      order.poNumber.toLowerCase().includes(query) ||
      order.sourcingCase.title.toLowerCase().includes(query) ||
      order.items.some((item) => item.productName.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });
  const groups = Object.values(
    filtered.reduce<Record<string, { supplier: SupplierOrder["supplier"]; orders: SupplierOrder[] }>>(
      (acc, order) => {
        const group = (acc[order.supplier.id] ||= { supplier: order.supplier, orders: [] });
        group.orders.push(order);
        return acc;
      },
      {},
    ),
  );
  const placingOrders = (orders as SupplierOrder[]).filter(
    (order) => order.id === placingOrderId,
  );
  const selectedUnits = placingOrders.flatMap((order) => order.items).reduce((sum, item) => sum + item.quantity, 0);
  const selectedTotal = placingOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const currency = placingOrders[0]?.currency || "";

  if (isLoading) return <div className="h-48 animate-pulse rounded-xl bg-muted" />;
  if (error) return <Card><CardContent className="p-6 text-destructive">Unable to load supplier orders.</CardContent></Card>;

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b">
        <h2 className="mr-auto text-lg font-semibold">Supplier Orders</h2>
        <div className="flex flex-wrap gap-x-6">
          {["all", "approved", "ordered", "shipping", "received"].map((value) => (
            <button key={value} type="button" onClick={() => setStatus(value)} className={`border-b-2 px-1 pb-3 text-sm font-medium ${status === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {value === "all" ? "All" : statusLabel(value)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center border-b pb-4">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} className="ml-auto min-w-[260px] max-w-md" placeholder="Supplier, product, request, or PO number" />
      </div>
      <div className="grid grid-cols-[minmax(280px,1fr)_100px_100px_120px_115px] gap-3 bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
        <span>Product(s)</span><span>Quantity</span><span>Status</span><span>Order total</span><span>Actions</span>
      </div>
      <p className="text-sm text-muted-foreground">{groups.length} supplier{groups.length === 1 ? "" : "s"} · {filtered.length} purchase order{filtered.length === 1 ? "" : "s"}</p>
      {groups.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No supplier orders found.</CardContent></Card>
      ) : groups.map((group) => {
        const groupUnits = group.orders.flatMap((order) => order.items).reduce((sum, item) => sum + item.quantity, 0);
        const groupTotal = group.orders.reduce((sum, order) => sum + order.totalAmount, 0);
        return <Card key={group.supplier.id} className="overflow-hidden rounded-md shadow-none">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-3 bg-muted/50 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{group.supplier.name} <span className="ml-2 font-normal text-muted-foreground">{group.orders.length} POs · {group.orders.flatMap((order) => order.items).length} products · {groupUnits.toLocaleString()} units</span></p>
              </div>
              <p className="font-medium">{group.orders[0]?.currency} {groupTotal.toLocaleString()}</p>
            </div>
            <div className="divide-y">
              {group.orders.map((order) => <div key={order.id}>
                <div className="flex items-center justify-between bg-muted/30 px-4 py-2 text-xs text-muted-foreground"><span>Order ID: <Link className="hover:underline" href={`${basePath}/${order.sourcingCase.id}`}>{order.poNumber} · {order.sourcingCase.title}</Link></span><span>{order.supplierOrderReference ? `Ref: ${order.supplierOrderReference}` : ""}</span></div>
                {order.items.map((item, index) => <div key={item.id} className="grid grid-cols-[minmax(280px,1fr)_100px_100px_120px_115px] gap-3 px-4 py-3 text-sm">
                  <div className="flex min-w-0 gap-3">
                    {order.sourcingCase.attachments[0] ? <img src={order.sourcingCase.attachments[0].url} alt={order.sourcingCase.attachments[0].fileName || item.productName} className="h-12 w-12 shrink-0 rounded border object-cover" /> : <div className="h-12 w-12 shrink-0 rounded border bg-muted" />}
                    <div className="min-w-0"><p className="line-clamp-2 font-medium">{item.productName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item.sku || "No SKU"} · {order.currency} {item.unitCost.toLocaleString()} each</p></div>
                  </div>
                  <span className="pt-1">x{item.quantity.toLocaleString()}</span>
                  {index === 0 ? <Badge variant={statusVariant(order.status) as any} className="h-fit w-fit capitalize">{statusLabel(order.status)}</Badge> : <span />}
                  {index === 0 ? <span className="pt-1 font-medium">{order.currency} {order.totalAmount.toLocaleString()}</span> : <span />}
                  {index === 0 ? <Button size="sm" variant="link" className="h-auto justify-start px-0" onClick={() => {
                    if (order.status !== "approved") return;
                    setPlacingOrderId(order.id);
                  }}>{order.status === "approved" ? "Arrange order" : "View order"}</Button> : <span />}
                </div>
                )}
              </div>)}
            </div>
          </CardContent>
        </Card>;
      })}
      <Dialog open={!!placingOrderId} onOpenChange={(open) => !open && setPlacingOrderId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Arrange supplier order</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm"><p className="font-medium">{placingOrders[0]?.supplier.name}</p><p className="text-muted-foreground">{placingOrders.length} POs · {selectedUnits.toLocaleString()} units · {currency} {selectedTotal.toLocaleString()}</p><Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Supplier order reference (optional)" /><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes (optional)" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setPlacingOrderId(null)}>Cancel</Button><Button isLoading={batchPlace.isPending} onClick={async () => { await batchPlace.mutateAsync({ purchaseOrderIds: placingOrders.map((order) => order.id), reference, notes }); setPlacingOrderId(null); setReference(""); setNotes(""); }}><PackageCheck /> Mark as placed</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
