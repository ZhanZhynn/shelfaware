"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useWarehouses } from "@/hooks/queries/use-warehouses";
import { usePurchaseOrders } from "@/hooks/queries/use-purchase-orders";
import { useProductLookup, useReceiveItems } from "@/hooks/queries/use-receiving";
import { Plus, Trash2, ScanLine, PackagePlus, Search, Loader2 } from "lucide-react";

const BarcodeScannerDialog = dynamic(() => import("@/components/ui/barcode-scanner"), { ssr: false });

interface PendingItem {
  productId: string;
  sku?: string;
  name: string;
  quantity: number;
  poItemId?: string;
  imageUrl?: string;
  source: "scan" | "po";
}

export default function ScanToReceivePanel() {
  const { data: warehouses } = useWarehouses();
  const { data: purchaseOrders } = usePurchaseOrders({ status: "approved" });
  const receiveMutation = useReceiveItems();

  const [warehouseId, setWarehouseId] = useState("");
  const [poId, setPoId] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualSku, setManualSku] = useState("");
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);

  const lookup = useProductLookup(null);
  const [lookupQuery, setLookupQuery] = useState<string | null>(null);

  const addToPending = (item: PendingItem) => {
    setPendingItems((prev) => {
      const existing = prev.find((p) => p.productId === item.productId && p.poItemId === item.poItemId);
      if (existing) {
        return prev.map((p) =>
          p === existing ? { ...p, quantity: p.quantity + item.quantity } : p,
        );
      }
      return [...prev, item];
    });
  };

  const handleDetected = useCallback(
    (text: string) => {
      setLookupQuery(text);
      lookup.refetch().then((res) => {
        if (res.data) {
          addToPending({
            productId: res.data.productId,
            sku: res.data.sku,
            name: res.data.name,
            quantity: 1,
            imageUrl: res.data.imageUrl,
            source: "scan",
          });
        }
        setLookupQuery(null);
      }).catch(() => setLookupQuery(null));
    },
    [lookup],
  );

  const handleManualLookup = () => {
    if (!manualSku.trim()) return;
    handleDetected(manualSku.trim());
    setManualSku("");
  };

  const updateQty = (index: number, qty: number) => {
    setPendingItems((prev) =>
      prev.map((p, i) => (i === index ? { ...p, quantity: Math.max(1, qty) } : p)),
    );
  };

  const removeItem = (index: number) => {
    setPendingItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSelectPo = (id: string) => {
    setPoId(id);
    if (!id) {
      setPendingItems((prev) => prev.filter((p) => p.source !== "po"));
      return;
    }
    // Pre-fill pending items from PO items
    const po = purchaseOrders?.find((p) => p.id === id);
    if (po) {
      const poItems: PendingItem[] = po.items
        .filter((item) => item.quantityReceived < item.quantity)
        .map((item) => ({
          productId: item.productId,
          sku: item.sku,
          name: item.productName,
          quantity: item.quantity - item.quantityReceived,
          poItemId: item.id,
          source: "po" as const,
        }));
      setPendingItems((prev) => [...prev.filter((p) => p.source !== "po"), ...poItems]);
    }
  };

  const handleReceive = () => {
    if (!warehouseId || pendingItems.length === 0) return;
    receiveMutation.mutate(
      {
        warehouseId,
        poId: poId || undefined,
        items: pendingItems.map((p) => ({
          productId: p.productId,
          sku: p.sku,
          quantity: p.quantity,
          poItemId: p.poItemId,
        })),
      },
      {
        onSuccess: () => {
          setPendingItems([]);
          setPoId("");
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs">Warehouse</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger>
              <SelectValue placeholder="Select warehouse" />
            </SelectTrigger>
            <SelectContent>
              {warehouses?.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Purchase Order (optional)</Label>
          <Select value={poId} onValueChange={handleSelectPo}>
            <SelectTrigger>
              <SelectValue placeholder="No PO — ad-hoc receive" />
            </SelectTrigger>
            <SelectContent>
              {purchaseOrders?.map((po) => (
                <SelectItem key={po.id} value={po.id}>
                  {po.poNumber} — {po.supplierName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <Button
            className="flex-1"
            onClick={() => setScannerOpen(true)}
            disabled={!warehouseId}
          >
            <ScanLine className="h-4 w-4 mr-2" />
            Scan
          </Button>
        </div>
      </div>

      {poId && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 p-3">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            PO-linked receiving: items from the selected PO are pre-filled below. Quantities default to remaining (ordered − received). Adjust as needed.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Or enter SKU manually..."
          value={manualSku}
          onChange={(e) => setManualSku(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleManualLookup();
          }}
          disabled={!warehouseId}
        />
        <Button variant="outline" onClick={handleManualLookup} disabled={!warehouseId || !manualSku.trim()}>
          {lookupQuery ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2">
              <PackagePlus className="h-4 w-4" />
              Pending Receive ({pendingItems.length})
            </span>
            {pendingItems.length > 0 && (
              <Button
                onClick={handleReceive}
                disabled={!warehouseId || receiveMutation.isPending}
              >
                {receiveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Receive All
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No items pending. Scan a product QR code or enter a SKU to begin.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-24">Qty</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingItems.map((item, index) => (
                  <TableRow key={`${item.productId}-${item.poItemId ?? "adhoc"}`}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground">{item.sku ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={item.source === "po" ? "default" : "secondary"}>
                        {item.source === "po" ? "PO" : "Scan"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateQty(index, parseInt(e.target.value, 10) || 1)}
                        className="w-20"
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {scannerOpen && (
        <BarcodeScannerDialog
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          onDetected={handleDetected}
        />
      )}
    </div>
  );
}
