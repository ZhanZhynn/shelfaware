"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useBatchPlaceSupplierOrders,
  useSupplierOrders,
} from "@/hooks/queries";
import { useShipPurchaseOrder } from "@/hooks/queries/use-purchase-orders";
import { ArrangeSupplierOrderDialog } from "./ArrangeSupplierOrderDialog";
import { ShipOrderDialog } from "./ShipOrderDialog";
import { SupplierOrderGroup } from "./SupplierOrderGroup";

type SupplierOrder = {
  id: string;
  poNumber: string;
  status: string;
  currency: string;
  totalAmount: number;
  supplierOrderReference?: string | null;
  supplierOrderPlacedAt?: string | null;
  supplier: { id: string; name: string };
  sourcingCase: {
    id: string;
    title: string;
    attachments: Array<{
      url: string;
      fileName?: string | null;
      caseVariantId?: string | null;
    }>;
  };
  items: Array<{
    id: string;
    productName: string;
    sku?: string | null;
    quantity: number;
    unitCost: number;
    subtotal: number;
    sourcingCaseVariantId?: string | null;
  }>;
};

const statusLabel = (status: string) => status.replaceAll("_", " ");
// Tabs are action-oriented; row badges keep the literal status.
const tabLabels: Record<string, string> = {
  all: "All",
  approved: "To Order",
  ordered: "To Ship",
  shipping: "Shipping",
  received: "Completed",
};
export function SupplierOrderQueue({
  workspaceId,
  basePath,
}: {
  workspaceId: string;
  basePath: string;
}) {
  const { data: orders = [], isLoading, error } = useSupplierOrders(workspaceId);
  const batchPlace = useBatchPlaceSupplierOrders();
  const shipOrder = useShipPurchaseOrder();
  const [status, setStatus] = useState("approved");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [placingOrderId, setPlacingOrderId] = useState<string | null>(null);
  const [shippingOrderId, setShippingOrderId] = useState<string | null>(null);
  // Tab counts come from the full set so they stay stable while searching,
  // mirroring the Requests queue. Supplier pill counts scope to the active
  // status tab so they always describe the orders the tab can show.
  const allOrders = orders as SupplierOrder[];
  const statusCounts = allOrders.reduce<Record<string, number>>(
    (acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      acc.all = (acc.all || 0) + 1;
      return acc;
    },
    {},
  );
  const statusOrders = allOrders.filter(
    (order) => status === "all" || order.status === status,
  );
  const supplierCounts = new Map(
    [...statusOrders.reduce((acc, order) => {
      const entry = acc.get(order.supplier.id) || { supplier: order.supplier, count: 0 };
      return acc.set(order.supplier.id, { ...entry, count: entry.count + 1 });
    }, new Map<string, { supplier: SupplierOrder["supplier"]; count: number }>())]
      .sort((a, b) => b[1].count - a[1].count),
  );
  // A supplier picked on another tab may have nothing here; fall back to All.
  const activeSupplierFilter =
    supplierFilter === "all" ||
    statusOrders.some((order) => order.supplier.id === supplierFilter)
      ? supplierFilter
      : "all";
  const filtered = allOrders.filter((order) => {
    const matchesStatus = status === "all" || order.status === status;
    const matchesSupplier =
      activeSupplierFilter === "all" ||
      order.supplier.id === activeSupplierFilter;
    const query = search.toLowerCase();
    const matchesSearch =
      !query ||
      order.supplier.name.toLowerCase().includes(query) ||
      order.poNumber.toLowerCase().includes(query) ||
      order.sourcingCase.title.toLowerCase().includes(query) ||
      order.items.some((item) => item.productName.toLowerCase().includes(query));
    return matchesStatus && matchesSupplier && matchesSearch;
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
  const shippingOrder = (orders as SupplierOrder[]).find(
    (order) => order.id === shippingOrderId,
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
              {tabLabels[value] || statusLabel(value)} <span className="ml-1">({statusCounts[value] || 0})</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
        <span className="mr-1 font-medium text-muted-foreground">Supplier</span>
        {[["all", "All", statusOrders.length] as const, ...[...supplierCounts.values()].map((entry) => [entry.supplier.id, entry.supplier.name, entry.count] as const)].map(([id, name, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSupplierFilter(id)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              activeSupplierFilter === id
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {name} ({count})
          </button>
        ))}
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
      ) : groups.map((group) => (
        <SupplierOrderGroup
          key={group.supplier.id}
          orders={group.orders}
          detailHref={(order) => `${basePath}/${(order as SupplierOrder).sourcingCase.id}`}
          imageForItem={(order, item) => {
            const sourcingCase = (order as SupplierOrder).sourcingCase;
            return (
              sourcingCase.attachments.find(
                (attachment) =>
                  attachment.caseVariantId &&
                  attachment.caseVariantId === item.sourcingCaseVariantId,
              ) || sourcingCase.attachments[0]
            );
          }}
          onArrangeOrder={(order) => setPlacingOrderId(order.id)}
          onShipOrder={(order) => setShippingOrderId(order.id)}
        />
      ))}
      <ArrangeSupplierOrderDialog
        key={placingOrderId || "none"}
        open={!!placingOrderId}
        onOpenChange={(open) => !open && setPlacingOrderId(null)}
        supplierName={placingOrders[0]?.supplier.name}
        poCount={placingOrders.length}
        units={selectedUnits}
        currency={currency}
        totalAmount={selectedTotal}
        isPending={batchPlace.isPending}
        onSubmit={async (input) => {
          await batchPlace.mutateAsync({
            purchaseOrderIds: placingOrders.map((order) => order.id),
            ...input,
          });
          setPlacingOrderId(null);
        }}
      />
      <ShipOrderDialog
        open={!!shippingOrderId}
        onOpenChange={(open) => !open && setShippingOrderId(null)}
        caseTitle={shippingOrder?.sourcingCase.title}
        poNumber={shippingOrder?.poNumber}
        supplierName={shippingOrder?.supplier.name}
        currency={shippingOrder?.currency}
        totalAmount={shippingOrder?.totalAmount}
        isPending={shipOrder.isPending}
        onSubmit={async (input) => {
          if (!shippingOrder) return;
          await shipOrder.mutateAsync({ id: shippingOrder.id, ...input });
          setShippingOrderId(null);
        }}
      />
    </div>
  );
}
