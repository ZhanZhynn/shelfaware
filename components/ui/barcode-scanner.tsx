"use client";

import dynamic from "next/dynamic";
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, X, Search, AlertCircle } from "lucide-react";

// Dynamically import the scanner hook component to avoid SSR issues with camera APIs
const ScannerView = dynamic(() => import("./scanner-view"), { ssr: false });

interface BarcodeScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (text: string) => void;
}

export default function BarcodeScannerDialog({
  open,
  onOpenChange,
  onDetected,
}: BarcodeScannerDialogProps) {
  const [manualInput, setManualInput] = useState("");

  const handleDetected = useCallback(
    (text: string) => {
      onDetected(text);
      onOpenChange(false);
    },
    [onDetected, onOpenChange],
  );

  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      handleDetected(manualInput.trim());
      setManualInput("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Scan Barcode / QR Code
          </DialogTitle>
        </DialogHeader>

        {open && <ScannerView onDetected={handleDetected} />}

        <div className="border-t pt-4">
          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Or enter SKU / product ID manually:
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Enter SKU or scan result..."
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleManualSubmit();
              }}
            />
            <Button size="icon" onClick={handleManualSubmit} disabled={!manualInput.trim()}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
