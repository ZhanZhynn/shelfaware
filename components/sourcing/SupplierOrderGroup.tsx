"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type SupplierOrderItem = {
  id: string;
  productName: string;
  sku?: string | null;
  quantity: number;
  unitCost: number;
  sourcingCaseVariantId?: string | null;
};

export type SupplierOrder = {
  id: string;
  poNumber: string;
  status: string;
  currency: string;
  totalAmount: number;
  supplierOrderReference?: string | null;
  supplier: { id: string; name: string };
  items: SupplierOrderItem[];
};

type OrderImage = { url: string; fileName?: string | null } | null | undefined;

const statusLabel = (status: string) => status.replaceAll("_", " ");
const statusVariant = (status: string) =>
  status === "approved" ? "warning" : status === "received" ? "success" : "info";

export function SupplierOrderGroup({
  orders,
  detailHref,
  imageForItem,
  onArrangeOrder,
  onShipOrder,
}: {
  orders: SupplierOrder[];
  detailHref: (order: SupplierOrder) => string;
  imageForItem?: (order: SupplierOrder, item: SupplierOrderItem) => OrderImage;
  onArrangeOrder?: (order: SupplierOrder) => void;
  onShipOrder?: (order: SupplierOrder) => void;
}) {
  const supplier = orders[0]?.supplier;
  const items = orders.flatMap((order) => order.items);
  const units = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const total = orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const currency = orders[0]?.currency || "CNY";

  if (!supplier) return null;

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex flex-wrap items-center gap-3 bg-muted/50 px-4 py-3 text-sm">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {supplier.name}{" "}
            <span className="ml-2 font-normal text-muted-foreground">
              {orders.length} PO{orders.length === 1 ? "" : "s"} · {items.length} product
              {items.length === 1 ? "" : "s"} · {units.toLocaleString()} units
            </span>
          </p>
        </div>
        <p className="font-medium">
          {currency} {total.toLocaleString()}
        </p>
      </div>
      <div className="divide-y">
        {orders.map((order) => (
          <div key={order.id}>
            <div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
              <span>
                {order.poNumber}
                {order.supplierOrderReference
                  ? ` · Ref: ${order.supplierOrderReference}`
                  : ""}
              </span>
              <Link className="text-sky-600 hover:underline" href={detailHref(order)}>
                View purchase order
              </Link>
            </div>
            {order.items.map((item, index) => {
              const image = imageForItem?.(order, item);
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(220px,1fr)_90px_100px_120px_115px] gap-3 px-4 py-3 text-sm"
                >
                  <div className="flex min-w-0 gap-3">
                    {image ? (
                      // Authenticated attachment URLs cannot use next/image.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image.url}
                        alt={image.fileName || item.productName}
                        className="h-12 w-12 shrink-0 rounded border object-cover"
                      />
                    ) : (
                      <div className="h-12 w-12 shrink-0 rounded border bg-muted" />
                    )}
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-medium">{item.productName}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {item.sku || "No SKU"} · {order.currency} {Number(item.unitCost || 0).toLocaleString()} each
                      </p>
                    </div>
                  </div>
                  <span className="pt-1">x{Number(item.quantity || 0).toLocaleString()}</span>
                  {index === 0 ? (
                    <Badge variant={statusVariant(order.status) as any} className="h-fit w-fit capitalize">
                      {statusLabel(order.status)}
                    </Badge>
                  ) : <span />}
                  {index === 0 ? (
                    <span className="pt-1 font-medium">
                      {order.currency} {Number(order.totalAmount || 0).toLocaleString()}
                    </span>
                  ) : <span />}
                  {index === 0 ? (
                    order.status === "approved" && onArrangeOrder ? (
                      <Button size="sm" variant="link" className="h-auto justify-start px-0" onClick={() => onArrangeOrder(order)}>
                        Arrange order
                      </Button>
                    ) : order.status === "ordered" && onShipOrder ? (
                      <Button size="sm" variant="link" className="h-auto justify-start px-0" onClick={() => onShipOrder(order)}>
                        Ship order
                      </Button>
                    ) : <span />
                  ) : <span />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
