"use client";

import { Badge } from "@/components/ui/badge";

// ─── Variant types per marketplace ─────────────────────────────────────────

interface TikTokVariant {
  tiktokSkuId?: string;
  sellerSku?: string | null;
  price: number;
  originalPrice?: number | null;
  currency?: string | null;
  totalQuantity: number;
  imageUrl?: string | null;
  status?: string;
  salesAttrs?: unknown;
}

interface ShopifyVariant {
  id?: string;
  title?: string;
  displayName?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price: number;
  compareAtPrice?: number | null;
  inventoryQuantity: number;
  inventoryPolicy?: string | null;
  position?: number | null;
  availableForSale?: boolean;
}

interface ShopeeVariant {
  id?: string;
  modelId?: number;
  modelName?: string;
  modelSku?: string | null;
  price: number;
  originalPrice?: number | null;
  stock: number;
  status?: string;
  tierIndex?: unknown;
}

interface LazadaVariant {
  id?: string;
  skuId?: number;
  sellerSku?: string | null;
  shopSku?: string | null;
  variation?: string | null;
  price: number;
  specialPrice?: number | null;
  stock: number;
  available?: number | null;
  status?: string;
  images?: unknown;
}

export type MarketplaceVariant = TikTokVariant | ShopifyVariant | ShopeeVariant | LazadaVariant;

export type Marketplace = "tiktok" | "shopify" | "shopee" | "lazada";

interface VariantSubTableProps {
  variants: MarketplaceVariant[];
  marketplace: Marketplace;
}

// ─── Sales Attributes Display (TikTok) ─────────────────────────────────────

function formatSalesAttrs(attrs: unknown): string {
  if (!attrs || typeof attrs !== "object") return "";
  if (Array.isArray(attrs)) {
    return attrs
      .map((a: Record<string, string>) =>
        a.attribute_name && a.attribute_value_name
          ? `${a.attribute_name}: ${a.attribute_value_name}`
          : null,
      )
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

// ─── Column renderers per marketplace ──────────────────────────────────────

function TikTokVariantRow({ variant }: { variant: TikTokVariant }) {
  return (
    <tr className="border-b border-border/30 last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2">
        {variant.imageUrl ? (
          <img src={variant.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
        ) : (
          <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">—</div>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {variant.sellerSku || variant.tiktokSkuId || "—"}
      </td>
      <td className="px-3 py-2 text-sm">
        {formatSalesAttrs(variant.salesAttrs) || "—"}
      </td>
      <td className="px-3 py-2 text-sm font-medium">
        {variant.price.toFixed(2)}
        {variant.originalPrice != null && variant.originalPrice > variant.price && (
          <span className="ml-2 text-xs text-muted-foreground line-through">
            {variant.originalPrice.toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge variant={variant.totalQuantity === 0 ? "destructive" : variant.totalQuantity < 10 ? "warning" : "success"}>
          {variant.totalQuantity}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <Badge variant={variant.status === "NORMAL" ? "success" : "secondary"}>
          {variant.status || "NORMAL"}
        </Badge>
      </td>
    </tr>
  );
}

function ShopifyVariantRow({ variant }: { variant: ShopifyVariant }) {
  return (
    <tr className="border-b border-border/30 last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {variant.sku || "—"}
      </td>
      <td className="px-3 py-2 text-sm">
        {variant.title || variant.displayName || "—"}
      </td>
      <td className="px-3 py-2 text-sm font-medium">
        {variant.price.toFixed(2)}
        {variant.compareAtPrice != null && variant.compareAtPrice > variant.price && (
          <span className="ml-2 text-xs text-muted-foreground line-through">
            {variant.compareAtPrice.toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge variant={variant.inventoryQuantity === 0 ? "destructive" : variant.inventoryQuantity < 10 ? "warning" : "success"}>
          {variant.inventoryQuantity}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <Badge variant={variant.availableForSale !== false ? "success" : "secondary"}>
          {variant.availableForSale !== false ? "Available" : "Unavailable"}
        </Badge>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {variant.barcode || "—"}
      </td>
    </tr>
  );
}

function ShopeeVariantRow({ variant }: { variant: ShopeeVariant }) {
  return (
    <tr className="border-b border-border/30 last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2 text-sm">
        {variant.modelName || "—"}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {variant.modelSku || "—"}
      </td>
      <td className="px-3 py-2 text-sm font-medium">
        ${variant.price.toFixed(2)}
        {variant.originalPrice != null && variant.originalPrice > variant.price && (
          <span className="ml-2 text-xs text-muted-foreground line-through">
            ${variant.originalPrice.toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge variant={variant.stock === 0 ? "destructive" : variant.stock < 10 ? "warning" : "success"}>
          {variant.stock}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <Badge variant={variant.status === "MODEL_NORMAL" ? "success" : "secondary"}>
          {variant.status || "MODEL_NORMAL"}
        </Badge>
      </td>
    </tr>
  );
}

function LazadaVariantRow({ variant }: { variant: LazadaVariant }) {
  return (
    <tr className="border-b border-border/30 last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2 text-sm">
        {variant.variation || "—"}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {variant.sellerSku || "—"}
      </td>
      <td className="px-3 py-2 text-sm font-medium">
        RM {variant.price.toFixed(2)}
        {variant.specialPrice != null && variant.specialPrice < variant.price && (
          <span className="ml-2 text-xs text-muted-foreground line-through">
            RM {variant.specialPrice.toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge variant={variant.stock === 0 ? "destructive" : variant.stock < 10 ? "warning" : "success"}>
          {variant.stock}
        </Badge>
      </td>
      <td className="px-3 py-2 text-sm text-muted-foreground">
        {variant.available ?? "—"}
      </td>
      <td className="px-3 py-2">
        <Badge variant={variant.status === "active" ? "success" : "secondary"}>
          {variant.status || "active"}
        </Badge>
      </td>
    </tr>
  );
}

// ─── Column headers per marketplace ────────────────────────────────────────

const HEADERS: Record<Marketplace, string[]> = {
  tiktok: ["Image", "SKU", "Attributes", "Price", "Stock", "Status"],
  shopify: ["SKU", "Title", "Price", "Stock", "Sale", "Barcode"],
  shopee: ["Name", "SKU", "Price", "Stock", "Status"],
  lazada: ["Variation", "SKU", "Price", "Stock", "Available", "Status"],
};

// ─── Main Component ────────────────────────────────────────────────────────

export default function VariantSubTable({ variants, marketplace }: VariantSubTableProps) {
  if (!variants || variants.length === 0) {
    return (
      <div className="px-6 py-4 text-sm text-muted-foreground text-center">
        No variants found
      </div>
    );
  }

  const headers = HEADERS[marketplace];

  return (
    <div className="px-6 py-2 bg-muted/20">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/30">
            {headers.map((h) => (
              <th key={h} className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {marketplace === "tiktok" &&
            (variants as TikTokVariant[]).map((v, i) => <TikTokVariantRow key={i} variant={v} />)}
          {marketplace === "shopify" &&
            (variants as ShopifyVariant[]).map((v, i) => <ShopifyVariantRow key={i} variant={v} />)}
          {marketplace === "shopee" &&
            (variants as ShopeeVariant[]).map((v, i) => <ShopeeVariantRow key={i} variant={v} />)}
          {marketplace === "lazada" &&
            (variants as LazadaVariant[]).map((v, i) => <LazadaVariantRow key={i} variant={v} />)}
        </tbody>
      </table>
    </div>
  );
}
