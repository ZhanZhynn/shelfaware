"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  X,
  Loader2,
  Store,
} from "lucide-react";

interface ImportResult {
  success: boolean;
  imported: number;
  orders: number;
  created: number;
  updated: number;
  itemsCreated: number;
  errors: string[];
  warnings: string[];
  fileName: string;
  shopName: string;
}

export default function ShopeeExcelImport() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [overrideShopId, setOverrideShopId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data: shops, isLoading: shopsLoading } = useQuery({
    queryKey: ["shopee", "shops"],
    queryFn: async () => {
      const response = await apiClient.shopee.getShops();
      return response.data;
    },
  });

  // Use a derived value for shopId — fall back to first shop if none selected
  const firstShopId = shops && shops.length > 0 ? shops[0]?.id ?? "" : "";
  const activeShopId = overrideShopId ?? firstShopId;

  const importMutation = useMutation({
    mutationFn: async (data: { file: File; shopId: string }) => {
      const formData = new FormData();
      formData.append("file", data.file);
      formData.append("shopId", data.shopId);

      const response = await fetch("/api/shopee/import", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Import failed");
      }

      return result as ImportResult;
    },
    onSuccess: (result) => {
      setImportResult(result);
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ["shopee"] });
    },
  });

  const handleFileSelect = useCallback((file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx") {
      alert("Please upload a Shopee Excel export (.xlsx)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("File too large. Maximum size is 10MB");
      return;
    }
    setSelectedFile(file);
    setImportResult(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleImport = () => {
    if (!selectedFile || !activeShopId) return;
    importMutation.mutate({ file: selectedFile, shopId: activeShopId });
  };

  const handleClear = () => {
    setSelectedFile(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!isMounted) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Excel Order Import</h1>
        <p className="text-muted-foreground mt-1">
          Import orders from Shopee Seller Center Excel export with unmasked address data
        </p>
      </div>

      {/* Shop Selector */}
      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Select Shop
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shopsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : shops && shops.length > 0 ? (
            <select
              value={activeShopId}
              onChange={(e) => setOverrideShopId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.shopName} (ID: {shop.shopId})
                </option>
              ))}
            </select>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              No connected shops found. Please connect a Shopee shop first.
            </div>
          )}
        </CardContent>
      </Card>

      {/* File Upload Area */}
      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload Excel File
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors
              ${
                isDragOver
                  ? "border-primary bg-primary/5"
                  : selectedFile
                    ? "border-green-500 bg-green-500/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
                  accept=".xlsx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
              className="hidden"
            />

            {selectedFile ? (
              <div className="space-y-2">
                <CheckCircle className="mx-auto h-8 w-8 text-green-500" />
                <p className="text-sm font-medium">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                >
                  <X className="mr-1 h-4 w-4" />
                  Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                  Drop your Excel file here or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports .xlsx files from Shopee Seller Center (max 10MB)
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Import Button */}
      {selectedFile && (
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="pt-6">
            <Button
              onClick={handleImport}
              disabled={!activeShopId || importMutation.isPending}
              className="w-full"
              size="lg"
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import Orders
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Import Result */}
      {importResult && (
        <Card
          className={`bg-gradient-to-br backdrop-blur-sm border ${
            importResult.success
              ? "from-green-500/5 to-green-500/10 border-green-500/30"
              : "from-red-500/5 to-red-500/10 border-red-500/30"
          }`}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {importResult.success ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500" />
              )}
              Import {importResult.success ? "Completed" : "Failed"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Orders</p>
                <p className="text-2xl font-bold">{importResult.orders}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Items Imported</p>
                <p className="text-2xl font-bold">{importResult.itemsCreated}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">New Orders</p>
                <p className="text-2xl font-bold text-green-500">
                  {importResult.created}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Updated Orders</p>
                <p className="text-2xl font-bold text-blue-500">
                  {importResult.updated}
                </p>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div>
                <p className="text-sm font-medium text-red-500 mb-2">Errors:</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {importResult.errors.map((error, i) => (
                    <div key={i} className="text-xs text-red-500 bg-red-500/5 p-2 rounded">
                      {error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4" />
              {importResult.fileName} → {importResult.shopName}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardHeader>
          <CardTitle>How to Export from Shopee Seller Center</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Go to Shopee Seller Center → Orders → My Sales</li>
            <li>Select the date range for completed orders</li>
            <li>Click &quot;Export&quot; to download the Excel file</li>
            <li>Upload the downloaded .xlsx file here</li>
          </ol>
          <div className="mt-4 p-3 rounded-lg bg-muted/50">
            <p className="text-sm font-medium">Note:</p>
            <p className="text-xs text-muted-foreground mt-1">
              This import uses the Excel export from Shopee Seller Center which includes
              unmasked address data (Province, City, District, Town). Orders with existing
              Order IDs will be updated with the latest data.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
