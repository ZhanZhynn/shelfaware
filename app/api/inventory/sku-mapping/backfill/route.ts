import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { canMutateSharedAttribution } from "@/lib/marketplace-attribution/access";
import { isSharedSkuMappingAnalyticsEnabled, isSharedSkuMappingMutationsEnabled } from "@/lib/marketplace-attribution/feature-flags";
import { commitBackfill, previewBackfill } from "@/lib/marketplace-attribution/backfill-service";
import { invalidateCache, cacheKeys } from "@/lib/cache/cache-utils";

function parseDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  const dateFrom = parseDate(input.dateFrom);
  const dateTo = parseDate(input.dateTo);
  if (!dateFrom || !dateTo || dateFrom > dateTo || dateTo.getTime() - dateFrom.getTime() > 366 * 86_400_000) return null;
  return { internalShopId: typeof input.internalShopId === "string" && input.internalShopId ? input.internalShopId : undefined, dateFrom, dateTo };
}

export async function POST(request: NextRequest) {
  if (!isSharedSkuMappingAnalyticsEnabled() || !isSharedSkuMappingMutationsEnabled()) return NextResponse.json({ error: "Marketplace attribution mutations are disabled." }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !canMutateSharedAttribution(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const input = parseBody(await request.json());
  if (!input) return NextResponse.json({ error: "Provide a valid dateFrom/dateTo range up to 366 days." }, { status: 400 });

  const result = await commitBackfill({
    platform: "shopee",
    ...input,
    initiatedById: session.id,
    idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
  }, session);
  await invalidateCache(cacheKeys.productPerformance.pattern);
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  if (!isSharedSkuMappingAnalyticsEnabled()) return NextResponse.json({ error: "Marketplace attribution analytics are disabled." }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !canMutateSharedAttribution(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const input = parseBody(Object.fromEntries(new URL(request.url).searchParams));
  if (!input) return NextResponse.json({ error: "Provide a valid dateFrom/dateTo range up to 366 days." }, { status: 400 });
  return NextResponse.json(await previewBackfill({ platform: "shopee", ...input }));
}
