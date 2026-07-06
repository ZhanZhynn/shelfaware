"use client";

import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { Button } from "@/components/ui/button";
import { Camera, CameraOff, AlertCircle } from "lucide-react";

export default function ScannerView({
  onDetected,
}: {
  onDetected: (text: string) => void;
}) {
  const { videoRef, isScanning, error, start, stop } = useBarcodeScanner(onDetected);

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          playsInline
        />
        {!isScanning && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Camera stopped</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <p className="text-sm text-rose-400">{error}</p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {!isScanning ? (
          <Button onClick={start} className="flex-1">
            <Camera className="h-4 w-4 mr-2" />
            Start Camera
          </Button>
        ) : (
          <Button onClick={stop} variant="destructive" className="flex-1">
            <CameraOff className="h-4 w-4 mr-2" />
            Stop Camera
          </Button>
        )}
      </div>
    </div>
  );
}
