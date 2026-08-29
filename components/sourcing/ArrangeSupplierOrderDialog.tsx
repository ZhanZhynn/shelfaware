"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ArrangeOrderInput = {
  reference?: string;
  notes?: string;
};

export function ArrangeSupplierOrderDialog({
  open,
  onOpenChange,
  supplierName,
  poCount = 1,
  units,
  currency,
  totalAmount,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierName?: string;
  poCount?: number;
  units?: number;
  currency?: string;
  totalAmount?: number;
  isPending: boolean;
  onSubmit: (input: ArrangeOrderInput) => Promise<void>;
}) {
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onOpenChange(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arrange supplier order</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="font-medium">{supplierName}</p>
          <p className="text-muted-foreground">
            {[
              `${poCount} ${poCount === 1 ? "PO" : "POs"}`,
              units != null ? `${units.toLocaleString()} units` : "",
              currency && totalAmount != null
                ? `${currency} ${totalAmount.toLocaleString()}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <label className="grid gap-1 text-sm font-medium">
            Supplier order reference (optional)
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="e.g. 1688 order number"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Notes (optional)
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Notes (optional)"
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            isLoading={isPending}
            onClick={async () => {
              await onSubmit({
                reference: reference.trim() || undefined,
                notes: notes.trim() || undefined,
              });
            }}
          >
            <PackageCheck /> Mark as placed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
