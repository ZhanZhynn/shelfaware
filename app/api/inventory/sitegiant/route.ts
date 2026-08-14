import { NextRequest, NextResponse } from "next/server";
import prisma from "@/prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { canViewSharedAttribution } from "@/lib/marketplace-attribution/access";

const pageSize = 50;

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewSharedAttribution(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
  const kind = request.nextUrl.searchParams.get("kind");
  const requestedPage = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? "1") || 1);
  const where = {
    ...(kind === "kit" ? { isKit: true } : kind === "item" ? { isKit: false } : {}),
    ...(search ? { OR: [{ code: { contains: search } }, { name: { contains: search } }] } : {}),
  };
  const [total, skus] = await Promise.all([
    prisma.salesSku.count({ where }),
    prisma.salesSku.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (requestedPage - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, code: true, name: true, active: true, isKit: true,
        recipes: {
          // Mongo persists null optional fields as absent; filtering for null
          // would hide every open-ended imported Sitegiant recipe.
          where: { status: "confirmed" },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { components: { select: { quantity: true, product: { select: { sku: true, name: true } } } } },
        },
      },
    }),
  ]);
  const componentSkus = skus.flatMap((sku) =>
    (sku.recipes[0]?.components ?? []).map((component) => component.product.sku),
  );
  const products = await prisma.product.findMany({
    where: { sku: { in: [...new Set([...skus.map((sku) => sku.code), ...componentSkus]) ] }, workspaceId: { not: null } },
    select: { sku: true, quantity: true, status: true },
  });
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const rows = skus.map((sku) => {
    const components = sku.recipes[0]?.components ?? [];
    const product = productBySku.get(sku.code);
    const theoreticalKitStock = sku.isKit && components.length
      ? (() => {
          const quantities = components.map((component) => {
            const componentProduct = productBySku.get(component.product.sku);
            return componentProduct ? Math.floor(Number(componentProduct.quantity) / component.quantity) : null;
          });
          return quantities.some((quantity) => quantity === null)
            ? null
            : Math.min(...(quantities as number[]));
        })()
      : null;
    return {
      id: sku.id, isku: sku.code, name: sku.name, active: sku.active,
      kind: sku.isKit ? "kit" : "item",
      physicalStock: product ? product.quantity.toString() : null,
      theoreticalKitStock,
      productStatus: product?.status ?? null,
      components: components.map((component) => ({ quantity: component.quantity, isku: component.product.sku, name: component.product.name })),
    };
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return NextResponse.json({ rows, pagination: { page: Math.min(requestedPage, totalPages), total, totalPages } });
}
