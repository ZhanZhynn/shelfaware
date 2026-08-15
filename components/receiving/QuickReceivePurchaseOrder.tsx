"use client";

import Link from "next/link";
import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { useReceiveItems } from "@/hooks/queries/use-receiving";
import { useWarehouses } from "@/hooks/queries/use-warehouses";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type QuickReceivePurchaseOrderProps = {
  order: {
    id: string;
    userId: string;
    workspaceId?: string | null;
    status: string;
    items: { id: string; productId: string; productName: string; quantity: number; quantityReceived: number }[];
  };
};

export function QuickReceivePurchaseOrder({ order }: QuickReceivePurchaseOrderProps) {
  const { data: warehouses } = useWarehouses();
  const receiveMutation = useReceiveItems();
  const [warehouseId, setWarehouseId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const unfinishedItems = order.items.filter((item) => item.quantityReceived < item.quantity);
  const compatibleWarehouses = (warehouses ?? []).filter((warehouse) =>
    warehouse.status && (order.workspaceId
      ? warehouse.workspaceId === order.workspaceId ||
        (!warehouse.workspaceId && warehouse.userId === order.userId)
      : !warehouse.workspaceId && warehouse.userId === order.userId),
  );

  const selectedWarehouseId = compatibleWarehouses.some((warehouse) => warehouse.id === warehouseId)
    ? warehouseId
    : compatibleWarehouses[0]?.id ?? "";

  if (!(["ordered", "shipping"].includes(order.status) && unfinishedItems.length > 0)) return null;

  const receiveAll = () => {
    if (!selectedWarehouseId || receiveMutation.isPending) return;
    receiveMutation.mutate({
      warehouseId: selectedWarehouseId,
      poId: order.id,
      items: unfinishedItems.map((item) => ({
        poItemId: item.id,
        productId: item.productId,
        quantity: item.quantity - item.quantityReceived,
        qualityStatus: "accepted" as const,
      })),
    }, {
      onSuccess: () => {
        setConfirmOpen(false);
        setWarehouseId("");
      },
    });
  };

  return (
    <>
      <Card className="border-sky-200 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">Ready for warehouse receiving</p>
            <p className="text-sm text-muted-foreground">{unfinishedItems.length} line item(s) still have units to receive.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setConfirmOpen(true)} disabled={compatibleWarehouses.length === 0 || receiveMutation.isPending}>
              <PackageCheck className="h-4 w-4" />Quick receive
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/receiving?poId=${order.id}`}>Receive with inspection</Link>
            </Button>
          </div>
          {compatibleWarehouses.length === 0 && (
            <p className="w-full text-sm text-destructive">No active warehouse is compatible with this purchase order.</p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!receiveMutation.isPending) setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quick receive all remaining units?</AlertDialogTitle>
            <AlertDialogDescription>
              ALL remaining units will be accepted. This skips inspection, partial quantities, and actual landed-cost entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            Warehouse
            <Select value={selectedWarehouseId} onValueChange={setWarehouseId} disabled={receiveMutation.isPending}>
              <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
              <SelectContent>
                {compatibleWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={receiveMutation.isPending}>Cancel</AlertDialogCancel>
            <Button onClick={receiveAll} isLoading={receiveMutation.isPending} disabled={!selectedWarehouseId}>
              Accept all remaining units
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
