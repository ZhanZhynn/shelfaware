"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, ExternalLink } from "lucide-react";
import {
  useCategories,
  useSuppliers,
  useCreateWmsProductFromShopee,
} from "@/hooks/queries";
import { DeferredSelectGate } from "@/components/shared";
import { formatMoney } from "@/lib/money";

interface ShopeeProductForDialog {
  id: string;
  shopeeItemId: number;
  itemName: string;
  itemSku: string | null;
  price: number;
  stock: number;
  imageUrl: string | null;
  variantCount?: number;
}

interface CreateWmsProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopeeProduct: ShopeeProductForDialog;
  existingWmsProductId?: string;
}

function formatCurrency(value: number): string {
  return formatMoney(value, "MYR");
}

export default function CreateWmsProductDialog({
  open,
  onOpenChange,
  shopeeProduct,
  existingWmsProductId,
}: CreateWmsProductDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [supplierError, setSupplierError] = useState("");

  const { data: categories = [] } = useCategories();
  const { data: suppliers = [] } = useSuppliers();
  const createMutation = useCreateWmsProductFromShopee();

  const activeCategories = categories.filter((c) => c.status !== false);
  const activeSuppliers = suppliers.filter((s) => s.status !== false);

  const sku = shopeeProduct.itemSku || `SHOPEE-${shopeeProduct.shopeeItemId}`;
  const isAlreadyMapped = !!existingWmsProductId;

  const handleSubmit = async () => {
    setCategoryError("");
    setSupplierError("");

    let valid = true;
    if (!selectedCategory) {
      setCategoryError("Category is required");
      valid = false;
    }
    if (!selectedSupplier) {
      setSupplierError("Supplier is required");
      valid = false;
    }
    if (!valid) return;

    createMutation.mutate(
      {
        shopeeProductId: shopeeProduct.id,
        categoryId: selectedCategory,
        supplierId: selectedSupplier,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setSelectedCategory("");
          setSelectedSupplier("");
        },
      },
    );
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedCategory("");
      setSelectedSupplier("");
      setCategoryError("");
      setSupplierError("");
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {isAlreadyMapped ? "Product Already Linked" : "Create WMS Product"}
          </DialogTitle>
          <DialogDescription>
            {isAlreadyMapped
              ? "This Shopee product is already linked to a WMS product."
              : "Create an inventory product from this Shopee listing."}
          </DialogDescription>
        </DialogHeader>

        {isAlreadyMapped ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/50">
              <p className="text-sm text-muted-foreground">
                Linked to WMS product:
              </p>
              <a
                href={`/admin/products/${existingWmsProductId}`}
                className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                View WMS Product
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Pre-filled Shopee data */}
            <div className="rounded-lg border p-4 bg-muted/50 space-y-3">
              <h4 className="text-sm font-medium">Shopee Listing Data</h4>
              {shopeeProduct.variantCount && shopeeProduct.variantCount > 1 && (
                <div className="rounded-md bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-sm text-blue-600">
                  This product has {shopeeProduct.variantCount} variants. Creating will produce {shopeeProduct.variantCount} WMS products (one per variant).
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Name</p>
                  <p className="font-medium truncate" title={shopeeProduct.itemName}>
                    {shopeeProduct.itemName}
                    {shopeeProduct.variantCount && shopeeProduct.variantCount > 1 && " (variants)"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">SKU</p>
                  <p className="font-medium font-mono text-xs">{sku}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Price</p>
                  <p className="font-medium">{formatCurrency(shopeeProduct.price)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Stock</p>
                  <p className="font-medium">{shopeeProduct.stock} units</p>
                </div>
              </div>
              {shopeeProduct.imageUrl && (
                <div className="flex items-center gap-2">
                  <img
                    src={shopeeProduct.imageUrl}
                    alt={shopeeProduct.itemName}
                    className="h-10 w-10 rounded object-cover"
                  />
                  <Badge variant="outline" className="text-xs">
                    Image will be copied
                  </Badge>
                </div>
              )}
            </div>

            {/* Category selection */}
            <div className="space-y-2">
              <Label>Category *</Label>
              <DeferredSelectGate
                enabled={open}
                placeholder={
                  <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
                    Select a category
                  </div>
                }
              >
                {() => (
                  <Select
                    value={selectedCategory}
                    onValueChange={(val) => {
                      setSelectedCategory(val);
                      setCategoryError("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </DeferredSelectGate>
              {categoryError && (
                <p className="text-xs text-destructive">{categoryError}</p>
              )}
            </div>

            {/* Supplier selection */}
            <div className="space-y-2">
              <Label>Supplier *</Label>
              <DeferredSelectGate
                enabled={open}
                placeholder={
                  <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
                    Select a supplier
                  </div>
                }
              >
                {() => (
                  <Select
                    value={selectedSupplier}
                    onValueChange={(val) => {
                      setSelectedSupplier(val);
                      setSupplierError("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeSuppliers.map((sup) => (
                        <SelectItem key={sup.id} value={sup.id}>
                          {sup.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </DeferredSelectGate>
              {supplierError && (
                <p className="text-xs text-destructive">{supplierError}</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            {isAlreadyMapped ? "Close" : "Cancel"}
          </Button>
          {!isAlreadyMapped && (
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                "Create Product"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
