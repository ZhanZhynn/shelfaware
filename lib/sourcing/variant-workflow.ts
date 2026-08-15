import { Prisma } from "@prisma/client";
import { ObjectId } from "mongodb";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "./auth";
import { normalizeSourcingCostConfig } from "./landed-cost";
import { variantViability } from "./variant-viability";
import type { SourcingVariantQuoteSheetInput, SourcingVariantSelectionInput } from "@/lib/validations/sourcing";

type Actor = { id: string; role: string | null; isSuperAdmin?: boolean; email: string; name: string };

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const variantLabel = (variant: { size?: string | null; material?: string | null; colour?: string | null }) =>
  [variant.size, variant.material, variant.colour].filter(Boolean).join(" / ") || "Standard";

export async function runVariantSourcingCommand(
  actor: Actor,
  caseId: string,
  command: { action: string; version: number; quoteId?: string; quoteSheet?: SourcingVariantQuoteSheetInput; selections?: SourcingVariantSelectionInput[] },
) {
  const item = await prisma.sourcingCase.findUnique({ where: { id: caseId }, include: { variants: true } });
  if (!item) throw new SourcingAccessError("Sourcing case not found", 404);
  const access = await requireWorkspaceRole(actor, item.workspaceId, ["admin", "sourcer"]);
  const canAdmin = access.globalAdmin || access.role === "admin";
  if (["save_variant_quote", "submit_variant_quote"].includes(command.action)) {
    if (!canAdmin && item.assignedToId !== actor.id) throw new SourcingAccessError("Only the assigned sourcer can submit supplier sheets", 403);
    if (!["sourcing", "changes_requested", "quoted"].includes(item.stage)) throw new SourcingAccessError("Supplier sheets cannot be changed at this stage", 409);
    const sheet = command.quoteSheet!;
    if (sheet.lines.length !== item.variants.length || new Set(sheet.lines.map((line) => line.caseVariantId)).size !== item.variants.length)
      throw new SourcingAccessError("Supplier sheet must account for every requested variant", 400);
    const variantsById = new Map(item.variants.map((variant) => [variant.id, variant]));
    if (sheet.lines.some((line) => !variantsById.has(line.caseVariantId))) throw new SourcingAccessError("Supplier sheet contains an unknown variant", 400);
    const workspace = await prisma.workspace.findUnique({ where: { id: item.workspaceId }, select: { sourcingCostConfig: true } });
    return prisma.$transaction(async (tx) => {
      const current = await tx.sourcingCase.findUnique({ where: { id: caseId } });
      if (!current || current.version !== command.version) throw new SourcingAccessError("This case has changed. Refresh and try again.", 409);
      const latest = await tx.sourcingQuote.findFirst({ where: { caseId }, orderBy: { revision: "desc" } });
      const existing = command.quoteId
        ? await tx.sourcingQuote.findFirst({ where: { id: command.quoteId, caseId }, include: { lines: true } })
        : null;
      if (command.quoteId && !existing) throw new SourcingAccessError("Supplier sheet not found", 404);
      if (!existing) {
        const duplicate = await tx.sourcingQuote.findFirst({
          where: { caseId, status: { in: ["draft", "submitted"] }, OR: sheet.supplierId ? [{ supplierId: sheet.supplierId }] : [{ supplierName: sheet.supplierName }] },
        });
        if (duplicate) throw new SourcingAccessError("This supplier already has a quote sheet. Select it to continue editing.", 409);
      }
      const status = command.action === "submit_variant_quote" ? "submitted" : "draft";
      let resolvedSupplierId = sheet.supplierId || null;
      if (status === "submitted" && !resolvedSupplierId) {
        const normalizedName = sheet.supplierName.trim();
        const existingSupplier = await tx.supplier.findFirst({
          where: { workspaceId: item.workspaceId, name: normalizedName },
          select: { id: true },
        });
        const supplier = existingSupplier ?? await tx.supplier.create({
          data: {
            name: normalizedName,
            workspaceId: item.workspaceId,
            userId: actor.id,
            createdBy: actor.id,
            status: true,
          },
          select: { id: true },
        });
        resolvedSupplierId = supplier.id;
      }
      const quoteData = {
        supplierId: resolvedSupplierId, supplierName: sheet.supplierName, currency: "CNY",
        items: json(sheet.lines.map((line) => {
          const variant = variantsById.get(line.caseVariantId)!;
          return { name: `${item.title} - ${variantLabel(variant)}`, sku: `SRC-${variant.id}`, quantity: variant.requestedQuantity, unitCost: line.unitPriceRmb ?? 0 };
        })),
        paymentTerms: sheet.paymentTerms || null, leadTimeDays: sheet.leadTimeDays ?? null, notes: sheet.notes || null,
        lines: { create: sheet.lines.map((line) => {
          const variant = variantsById.get(line.caseVariantId)!;
          const cost = variantViability(line, workspace?.sourcingCostConfig);
          return { workspaceId: item.workspaceId, caseVariantId: variant.id, availability: line.availability, size: variant.size, material: variant.material, colour: variant.colour, requestedQuantity: variant.requestedQuantity, unitPriceRmb: line.unitPriceRmb ?? null, piecesPerSellingUnit: line.piecesPerSellingUnit ?? null, cartonLengthCm: line.cartonLengthCm ?? null, cartonWidthCm: line.cartonWidthCm ?? null, cartonHeightCm: line.cartonHeightCm ?? null, piecesPerCarton: line.piecesPerCarton ?? null, marketPriceMyr: line.marketPriceMyr ?? null, marketPack: line.marketPack ?? null, overrideCostMyr: line.overrideCostMyr ?? null, moq: line.moq ?? null, leadTimeDays: line.leadTimeDays ?? sheet.leadTimeDays ?? null, notes: line.notes ?? null, costConfigSnapshot: json(normalizeSourcingCostConfig(workspace?.sourcingCostConfig)), landedCostSnapshot: cost.result ? json(cost.result) : undefined };
        }) },
      };
      const quote = existing?.status === "draft"
        ? await tx.sourcingQuote.update({ where: { id: existing.id }, data: { ...quoteData, status, lines: { deleteMany: {}, create: quoteData.lines.create } }, include: { lines: true } })
        : await tx.sourcingQuote.create({
        data: {
          workspaceId: item.workspaceId, caseId, quoteGroupId: existing?.quoteGroupId || new ObjectId().toHexString(), revision: (latest?.revision ?? 0) + 1,
          status, createdById: actor.id, ...quoteData,
        },
        include: { lines: true },
      });
      if (existing?.status === "submitted" && status === "submitted") await tx.sourcingQuote.update({ where: { id: existing.id }, data: { status: "superseded" } });
      await tx.sourcingCase.update({ where: { id: caseId }, data: { stage: status === "submitted" ? "quoted" : item.stage, version: { increment: 1 }, updatedAt: new Date() } });
      await tx.sourcingEvent.create({ data: { workspaceId: item.workspaceId, caseId, actorId: actor.id, type: status === "submitted" ? "variant_quote_submitted" : "variant_quote_saved", payload: json({ quoteId: quote.id, supplierName: quote.supplierName }) } });
      return quote;
    });
  }
  if (!canAdmin) throw new SourcingAccessError("Only workspace admins can make selections", 403);
  if (command.action === "confirm_variant_selection") {
    if (!command.selections || command.selections.length !== item.variants.length || new Set(command.selections.map((selection) => selection.caseVariantId)).size !== item.variants.length)
      throw new SourcingAccessError("Choose or skip every requested variant", 400);
    const variantIds = new Set(item.variants.map((variant) => variant.id));
    if (command.selections.some((selection) => !variantIds.has(selection.caseVariantId))) throw new SourcingAccessError("Unknown variant selection", 400);
    const workspace = await prisma.workspace.findUnique({ where: { id: item.workspaceId }, select: { sourcingCostConfig: true } });
    const selectedLineIds = command.selections.flatMap((selection) => selection.quoteLineId ? [selection.quoteLineId] : []);
    const lines = await prisma.sourcingQuoteLine.findMany({ where: { id: { in: selectedLineIds }, workspaceId: item.workspaceId }, include: { quote: true } });
    const linesById = new Map(lines.map((line) => [line.id, line]));
    for (const selection of command.selections) {
      if (!selection.quoteLineId) continue;
      const line = linesById.get(selection.quoteLineId);
      if (!line || line.caseVariantId !== selection.caseVariantId || line.quote.status !== "submitted") throw new SourcingAccessError("Selected offer is no longer available", 409);
      if (variantViability(line, workspace?.sourcingCostConfig).status !== "pass") throw new SourcingAccessError("Only passed offers can be selected", 409);
    }
    return prisma.$transaction(async (tx) => {
      const current = await tx.sourcingCase.findUnique({ where: { id: caseId } });
      if (!current || current.version !== command.version) throw new SourcingAccessError("This case has changed. Refresh and try again.", 409);
      await tx.sourcingVariantSelection.deleteMany({ where: { caseId } });
      await tx.sourcingVariantSelection.createMany({ data: command.selections!.map((selection) => ({ workspaceId: item.workspaceId, caseId, caseVariantId: selection.caseVariantId, quoteLineId: selection.status === "selected" ? selection.quoteLineId : null, status: selection.status, skipReason: selection.status === "skipped" ? selection.skipReason || null : null, decidedById: actor.id })) });
      const updated = await tx.sourcingCase.update({ where: { id: caseId }, data: { stage: "approved", version: { increment: 1 }, updatedAt: new Date() } });
      await tx.sourcingEvent.create({ data: { workspaceId: item.workspaceId, caseId, actorId: actor.id, type: "variant_selection_confirmed" } });
      return updated;
    });
  }
  if (command.action !== "create_variant_orders") throw new SourcingAccessError("Unknown variant sourcing command", 400);
  if (item.stage !== "approved") throw new SourcingAccessError("Confirm selections before creating purchase orders", 409);
  return prisma.$transaction(async (tx) => {
    const current = await tx.sourcingCase.findUnique({ where: { id: caseId }, include: { selections: { include: { quoteLine: { include: { quote: true, caseVariant: true } } } } } });
    if (!current || current.version !== command.version) throw new SourcingAccessError("This case has changed. Refresh and try again.", 409);
    const selected = current.selections.filter((selection) => selection.status === "selected" && selection.quoteLine);
    if (!selected.length) throw new SourcingAccessError("Select at least one variant before creating purchase orders", 409);
    const byQuote = new Map<string, typeof selected>();
    for (const selection of selected) { const quoteId = selection.quoteLine!.quoteId; byQuote.set(quoteId, [...(byQuote.get(quoteId) || []), selection]); }
    const purchaseOrderIds: string[] = [];
    for (const [quoteId, selections] of byQuote) {
      const header = selections[0]!.quoteLine!.quote;
      let supplier = header.supplierId ? await tx.supplier.findFirst({ where: { id: header.supplierId, workspaceId: current.workspaceId } }) : await tx.supplier.findFirst({ where: { name: header.supplierName, workspaceId: current.workspaceId } });
      if (!supplier) supplier = await tx.supplier.create({ data: { name: header.supplierName, workspaceId: current.workspaceId, userId: actor.id, createdBy: actor.id, status: true } });
      const poLines = [] as { productId: string; productName: string; sku: string; quantity: number; unitCost: number; variantId: string; quoteLineId: string }[];
      for (const selection of selections) {
        const line = selection.quoteLine!; const variant = line.caseVariant;
        const sku = `SRC-${variant.id}`; const productName = `${current.title} - ${variantLabel(variant)}`;
        let product = await tx.product.findFirst({ where: { sku, workspaceId: current.workspaceId } });
        if (!product) {
          let category = await tx.category.findFirst({ where: { workspaceId: current.workspaceId, status: true }, orderBy: { createdAt: "asc" } });
          if (!category) category = await tx.category.create({ data: { name: "Sourced", workspaceId: current.workspaceId, userId: actor.id, createdBy: actor.id, status: true } });
          product = await tx.product.create({ data: { name: productName, sku, skuScopeId: current.workspaceId, price: 0, quantity: BigInt(0), status: "active", categoryId: category.id, supplierId: supplier.id, userId: actor.id, createdBy: actor.id, workspaceId: current.workspaceId } });
        }
        poLines.push({ productId: product.id, productName, sku, quantity: Math.max(variant.requestedQuantity, line.moq ?? 0), unitCost: line.unitPriceRmb ?? 0, variantId: variant.id, quoteLineId: line.id });
      }
      const po = await tx.purchaseOrder.create({ data: { poNumber: `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`, supplierId: supplier.id, userId: actor.id, workspaceId: current.workspaceId, status: "ordered", currency: "CNY", totalAmount: poLines.reduce((total, line) => total + line.quantity * line.unitCost, 0), createdBy: actor.id, orderedAt: new Date(), items: { create: poLines.map((line) => ({ productId: line.productId, productName: line.productName, sku: line.sku, quantity: line.quantity, unitCost: line.unitCost, subtotal: line.quantity * line.unitCost, sourcingCaseVariantId: line.variantId, sourcingQuoteLineId: line.quoteLineId })) } } });
      await tx.sourcingOrder.create({ data: { workspaceId: current.workspaceId, caseId, quoteId, purchaseOrderId: po.id, createdById: actor.id } }); purchaseOrderIds.push(po.id);
    }
    const updated = await tx.sourcingCase.update({ where: { id: caseId }, data: { stage: "ordered", version: { increment: 1 }, updatedAt: new Date() } });
    await tx.sourcingEvent.create({ data: { workspaceId: current.workspaceId, caseId, actorId: actor.id, type: "variant_orders_created", payload: json({ purchaseOrderIds }) } });
    return { ...updated, purchaseOrderIds };
  });
}
