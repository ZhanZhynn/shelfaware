import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { canMutateSharedAttribution } from "@/lib/marketplace-attribution/access";
import { isSharedSkuMappingEnabled, isSharedSkuMappingMutationsEnabled } from "@/lib/marketplace-attribution/feature-flags";
import { commitCsvMappingDraft, createCsvMappingDraft, getCsvMappingDraft } from "@/lib/marketplace-attribution/service";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

async function admin(request: NextRequest) { const session = await getSessionFromRequest(request); return session && canMutateSharedAttribution(session) ? session : null; }

export async function GET(request: NextRequest) {
  if (!isSharedSkuMappingEnabled()) return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  if (!isSharedSkuMappingMutationsEnabled()) return NextResponse.json({ error: "Shared SKU mapping mutations are not enabled." }, { status: 403 });
  const session = await admin(request); if (!session) return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  const batchId = request.nextUrl.searchParams.get("batchId");
  try {
    if (batchId) return NextResponse.json(await getCsvMappingDraft(objectId.parse(batchId), session.id));
    if (request.nextUrl.searchParams.get("export") === "audit") {
      const mappings = await prisma.marketplaceSkuMapping.findMany({ include: { salesSku: { select: { code: true } } }, orderBy: { effectiveFrom: "asc" } });
      const header = ["platform", "shopId", "offerKey", "externalProductId", "externalVariantId", "salesSkuCode", "effectiveFrom", "effectiveTo", "recordType"];
      const lines = [header.join(","), ...mappings.map((mapping) => [mapping.platform, mapping.shopId, mapping.offerKey, mapping.externalProductId, mapping.externalVariantId ?? "", mapping.salesSku.code, mapping.effectiveFrom.toISOString(), mapping.effectiveTo?.toISOString() ?? "", "confirmed-mapping-audit"].map(quote).join(","))];
      return new NextResponse(lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=confirmed-sku-mapping-audit.csv" } });
    }
    return NextResponse.json(await prisma.marketplaceSkuMappingCsvImportBatch.findMany({ where: { actorId: session.id }, orderBy: { createdAt: "desc" }, take: 25, include: { rows: { orderBy: { rowNumber: "asc" } } } }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load CSV draft." }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  if (!isSharedSkuMappingEnabled()) return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  if (!isSharedSkuMappingMutationsEnabled()) return NextResponse.json({ error: "Shared SKU mapping mutations are not enabled." }, { status: 403 });
  const session = await admin(request); if (!session) return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = z.object({ action: z.enum(["create-draft", "commit"]), csv: z.string().max(1024 * 1024).optional(), filename: z.string().trim().min(1).max(200).optional(), batchId: objectId.optional(), idempotencyKey }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid CSV action and idempotency key." }, { status: 400 });
  try {
    if (parsed.data.action === "create-draft") {
      if (parsed.data.csv === undefined || !parsed.data.filename) return NextResponse.json({ error: "CSV text and filename are required." }, { status: 400 });
      return NextResponse.json(await createCsvMappingDraft({ csv: parsed.data.csv, filename: parsed.data.filename, idempotencyKey: parsed.data.idempotencyKey }, session.id), { status: 201 });
    }
    if (!parsed.data.batchId) return NextResponse.json({ error: "A CSV draft is required." }, { status: 400 });
    return NextResponse.json(await commitCsvMappingDraft(parsed.data.batchId, parsed.data.idempotencyKey, session.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process CSV mapping.";
    return NextResponse.json({ error: message }, { status: /idempotency|already committed/i.test(message) ? 409 : 400 });
  }
}
