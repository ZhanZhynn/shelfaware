"use client";

import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ShipOrderInput = {
  trackingCarrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  shippingNotes?: string;
};

export function ShipOrderDialog({
  open,
  onOpenChange,
  caseTitle,
  poNumber,
  supplierName,
  currency,
  totalAmount,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseTitle?: string;
  poNumber?: string;
  supplierName?: string;
  currency?: string;
  totalAmount?: number;
  isPending: boolean;
  onSubmit: (input: ShipOrderInput) => Promise<void>;
}) {
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [estimatedDelivery, setEstimatedDelivery] = useState("");
  const [shippingNotes, setShippingNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setTrackingCarrier("");
    setTrackingNumber("");
    setTrackingUrl("");
    setEstimatedDelivery("");
    setShippingNotes("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onOpenChange(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ship supplier order</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {caseTitle && <p className="font-medium">{caseTitle}</p>}
          <p className="text-muted-foreground">
            {[supplierName, poNumber, currency && totalAmount != null ? `${currency} ${totalAmount.toLocaleString()}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <label className="grid gap-1 text-sm font-medium">
            Carrier (optional)
            <Input
              value={trackingCarrier}
              onChange={(event) => setTrackingCarrier(event.target.value)}
              placeholder="e.g. DHL, SF Express"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Tracking number (optional)
            <Input
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
              placeholder="Add it now or update it later"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Tracking URL (optional)
            <Input
              value={trackingUrl}
              onChange={(event) => setTrackingUrl(event.target.value)}
              placeholder="Tracking URL (optional)"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Estimated delivery (optional)
            <Input
              type="date"
              value={estimatedDelivery}
              onChange={(event) => setEstimatedDelivery(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Shipping notes (optional)
            <Input
              value={shippingNotes}
              onChange={(event) => setShippingNotes(event.target.value)}
              placeholder="Shipping notes (optional)"
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
                trackingCarrier: trackingCarrier.trim() || undefined,
                trackingNumber: trackingNumber.trim() || undefined,
                trackingUrl: trackingUrl.trim() || undefined,
                estimatedDelivery: estimatedDelivery || undefined,
                shippingNotes: shippingNotes.trim() || undefined,
              });
            }}
          >
            <Truck /> Mark as shipped
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
