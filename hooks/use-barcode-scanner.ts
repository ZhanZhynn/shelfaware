"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
import { NotFoundException } from "@zxing/library";

interface UseBarcodeScannerResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isScanning: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Hook for camera-based barcode/QR scanning using @zxing/browser.
 * Manages camera lifecycle, continuous decode loop, and error handling.
 */
export function useBarcodeScanner(onDetected: (text: string) => void): UseBarcodeScannerResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  const stop = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!videoRef.current) {
      setError("Video element not ready");
      return;
    }

    try {
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result, _err) => {
          if (result) {
            const text = result.getText();
            if (text) {
              onDetectedRef.current(text);
            }
          }
          // NotFoundException is expected on every non-matching frame; ignore
        },
      );
      controlsRef.current = controls;
      setIsScanning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to access camera";
      setError(msg);
      setIsScanning(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (controlsRef.current) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
    };
  }, []);

  return { videoRef, isScanning, error, start, stop };
}

// Re-export to satisfy bundler tree-shaking of unused import
export type { NotFoundException };
