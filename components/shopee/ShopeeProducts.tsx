"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type Row,
} from "@tanstack/react-table";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Plus, Trash2 } from "lucide-react";
import { useShopeeProductMappingStatus } from "@/hooks/queries";
import { MarketplaceDataTable, VariantSubTable, type Marketplace } from "@/components/shared";
import CreateWmsProductDialog from "./CreateWmsProductDialog";
import BulkCreateWmsProductsDialog from "./BulkCreateWmsProductsDialog";

interface ShopeeProductRow {
  id: string;
  shopeeItemId: number;
  itemName: string;
  itemSku: string | null;
  price: number;
  originalPrice: number | null;
  stock: number;
  status: string;
  imageUrl: string | null;
  lastSyncedAt: string | null;
  variants?: Array<{
    id?: string;
    modelId?: number;
    modelName?: string;
    modelSku?: string | null;
    price: number;
    originalPrice?: number | null;
    stock: number;
    status?: string;
    tierIndex?: unknown;
  }>;
}

function renderShopeeVariants(row: Row<ShopeeProductRow>) {
  return <VariantSubTable variants={row.original.variants || []} marketplace="shopee" />;
}

export default function ShopeeProducts() {
  const searchParams = useSearchParams();
  const shopId = searchParams.get("shopId") || undefined;

  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ShopeeProductRow | null>(null);
  const limit = 10;

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["shopee", "products", page, search, shopId],
    queryFn: async () => {
      const response = await apiClient.shopee.getProducts({
        page,
        limit,
        search: search || undefined,
        shopId,
      });
      return response.data;
    },
  });

  const productIds = useMemo(
    () => (data?.products || []).map((p: ShopeeProductRow) => p.id),
    [data],
  );
  const { data: mappingData } = useShopeeProductMappingStatus(productIds);

  const mappingMap = useMemo(() => {
    const map: Record<string, { isMapped: boolean; variantCount: number; mappedVariantCount: number; wmsProductId?: string }> = {};
    if (mappingData?.mappings) {
      for (const m of mappingData.mappings) {
        map[m.shopeeProductId] = m;
      }
    }
    return map;
  }, [mappingData]);

  const selectedRowIds = useMemo(() => {
    return Object.keys(rowSelection).filter((key) => rowSelection[key]);
  }, [rowSelection]);

  const selectedProducts = useMemo(() => {
    const allProducts = (data?.products || []) as ShopeeProductRow[];
    return allProducts.filter((p) => selectedRowIds.includes(p.id));
  }, [data, selectedRowIds]);

  const columns = useMemo<ColumnDef<ShopeeProductRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300"
            checked={table.getIsAllPageRowsSelected()}
            onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300"
            checked={row.getIsSelected()}
            onChange={(e) => row.toggleSelected(e.target.checked)}
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "imageUrl",
        header: "Image",
        cell: ({ row }) => (
          <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center overflow-hidden">
            {row.original.imageUrl ? (
              <img src={row.original.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Package className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "itemName",
        header: "Product Name",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.itemName}</span>
        ),
      },
      {
        accessorKey: "shopeeItemId",
        header: "Item ID",
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-sm">{row.original.shopeeItemId}</span>
        ),
      },
      {
        accessorKey: "price",
        header: "Price",
        cell: ({ row }) => {
          const price = row.original.price;
          const originalPrice = row.original.originalPrice;
          return (
            <div className="flex flex-col">
              <span className="font-medium">${price.toFixed(2)}</span>
              {originalPrice && originalPrice > price && (
                <span className="text-xs text-muted-foreground line-through">
                  ${originalPrice.toFixed(2)}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "stock",
        header: "Stock",
        cell: ({ row }) => {
          const threshold = data?.lowStockThreshold ?? 10;
          const variant =
            row.original.stock === 0
              ? ("destructive" as const)
              : row.original.stock < threshold
                ? ("warning" as const)
                : ("success" as const);
          return <Badge variant={variant}>{row.original.stock}</Badge>;
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "NORMAL" ? "success" : "destructive"}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "lastSyncedAt",
        header: "Last Synced",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.lastSyncedAt
              ? new Date(row.original.lastSyncedAt).toLocaleDateString()
              : "Never"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "WMS",
        cell: ({ row }) => {
          const product = row.original;
          const mapping = mappingMap[product.id];
          if (mapping?.isMapped) {
            return (
              <a
                href={`/admin/products/${mapping.wmsProductId}`}
                className="text-xs text-primary hover:underline"
              >
                Linked
              </a>
            );
          }
          return (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setSelectedProduct(product);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              Create
            </Button>
          );
        },
        enableSorting: false,
      },
    ],
    [mappingMap, data],
  );

  const tableData = useMemo(() => (data?.products || []) as ShopeeProductRow[], [data]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    state: { sorting, rowSelection },
    getRowId: (row) => row.id,
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  if (!isMounted) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Shopee Products</h1>
      </div>

      <MarketplaceDataTable
        table={table}
        isLoading={isLoading}
        searchPlaceholder="Search products..."
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); setRowSelection({}); }}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        totalCount={data?.total}
        countLabel="products"
        emptyStateTitle="No products found"
        emptyStateIcon={Package}
        columnCount={columns.length}
        renderExpandedRow={renderShopeeVariants}
        headerActions={
          selectedRowIds.length > 0 ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{selectedRowIds.length} selected</Badge>
              <Button size="sm" onClick={() => setBulkDialogOpen(true)}>
                <Plus className="h-3 w-3 mr-1" />
                Create WMS Products
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRowSelection({})}>
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </Button>
            </div>
          ) : undefined
        }
      />

      {selectedProduct && (
        <CreateWmsProductDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          shopeeProduct={{
            id: selectedProduct.id,
            shopeeItemId: selectedProduct.shopeeItemId,
            itemName: selectedProduct.itemName,
            itemSku: selectedProduct.itemSku,
            price: selectedProduct.price,
            stock: selectedProduct.stock,
            imageUrl: selectedProduct.imageUrl,
            variantCount: selectedProduct.variants?.length,
          }}
          existingWmsProductId={mappingMap[selectedProduct.id]?.wmsProductId}
        />
      )}

      {bulkDialogOpen && (
        <BulkCreateWmsProductsDialog
          open={bulkDialogOpen}
          onOpenChange={setBulkDialogOpen}
          products={selectedProducts}
          onComplete={() => {
            setRowSelection({});
            setBulkDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}
