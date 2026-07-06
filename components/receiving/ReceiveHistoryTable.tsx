"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useStockMovements } from "@/hooks/queries/use-receiving";
import { Package } from "lucide-react";

export default function ReceiveHistoryTable() {
  const { data, isLoading } = useStockMovements({ limit: 50 });

  if (isLoading) {
    return <Skeleton className="h-[400px] rounded-[20px]" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Package className="h-4 w-4" />
          Recent Stock Movements
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No stock movements yet. Receive some stock to see history here.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(m.receivedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{m.productName ?? m.productId}</TableCell>
                  <TableCell className="text-muted-foreground">{m.warehouseName ?? m.warehouseId}</TableCell>
                  <TableCell className="text-right font-bold text-emerald-600">
                    +{m.quantity}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.sourceType === "purchase_order" ? "default" : "secondary"}>
                      {m.sourceType === "purchase_order" ? "PO" : "Ad-hoc"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.receivedByName ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.notes ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
