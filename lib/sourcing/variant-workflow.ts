import { Prisma } from "@prisma/client";
import { ObjectId } from "mongodb";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "./auth";
import { deliverSourcingNotification } from "./notifications";
import { logger } from "@/lib/logger";
import { normalizeSourcingCostConfig } from "./landed-cost";
import { variantViability } from "./variant-viability";
import type {
  SourcingVariantQuoteSheetInput,
  SourcingVariantSelectionInput,
  SourcingVariantUpdateInput,
  SourcingVariantInput,
} from "@/lib/validations/sourcing";

type Actor = {
  id: string;
  role: string | null;
  isSuperAdmin?: boolean;
  email: string;
  name: string;
};

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const variantLabel = (variant: {
  size?: string | null;
  material?: string | null;
  colour?: string | null;
}) =>
  [variant.size, variant.material, variant.colour]
    .filter(Boolean)
    .join(" / ") || "Standard";

export async function runVariantSourcingCommand(
  actor: Actor,
  caseId: string,
  command: {
    action: string;
    version: number;
    quoteId?: string;
    quoteLineId?: string;
    reason?: string;
    quoteSheet?: SourcingVariantQuoteSheetInput;
    selections?: SourcingVariantSelectionInput[];
    selection?: SourcingVariantSelectionInput;
    caseVariantId?: string;
    variant?: SourcingVariantUpdateInput;
    newVariant?: SourcingVariantInput;
  },
) {
  const item = await prisma.sourcingCase.findUnique({
    where: { id: caseId },
    include: { variants: true },
  });
  if (!item) throw new SourcingAccessError("Sourcing case not found", 404);
  const access = await requireWorkspaceRole(actor, item.workspaceId, [
    "admin",
    "sourcer",
  ]);
  const canAdmin = access.globalAdmin || access.role === "admin";
  if (["save_variant_quote", "submit_variant_quote"].includes(command.action)) {
    if (!canAdmin && item.assignedToId !== actor.id)
      throw new SourcingAccessError(
        "Only the assigned sourcer can submit supplier sheets",
        403,
      );
    if (!["sourcing", "changes_requested", "quoted"].includes(item.stage))
      throw new SourcingAccessError(
        "Supplier sheets cannot be changed at this stage",
        409,
      );
    const sheet = command.quoteSheet!;
    const requestedVariants = item.variants.filter(
      (variant) => variant.requestQuote !== false && variant.origin === "admin",
    );
    if (
      sheet.lines.length !== requestedVariants.length ||
      new Set(sheet.lines.map((line) => line.caseVariantId)).size !==
        requestedVariants.length
    )
      throw new SourcingAccessError(
        "Supplier sheet must account for every quote-enabled variant",
        400,
      );
    const variantsById = new Map(
      item.variants.map((variant) => [variant.id, variant]),
    );
    if (
      sheet.lines.some(
        (line) =>
          !variantsById.has(line.caseVariantId) ||
          variantsById.get(line.caseVariantId)!.requestQuote === false ||
          variantsById.get(line.caseVariantId)!.origin !== "admin",
      )
    )
      throw new SourcingAccessError(
        "Supplier sheet contains an unknown or unrequested variant",
        400,
      );
    if (command.action === "submit_variant_quote") {
      const incomplete = sheet.lines.find(
        (line) =>
          line.availability === "available" &&
          (!line.unitPriceRmb ||
            !line.piecesPerSellingUnit ||
            !line.cartonWeightKg ||
            !line.cartonLengthCm ||
            !line.cartonWidthCm ||
            !line.cartonHeightCm ||
            !line.piecesPerCarton),
      );
      if (incomplete)
        throw new SourcingAccessError(
          "Available variants need price, pieces per unit, carton weight, carton size, and pieces per carton before submission",
          400,
        );
    }
    const workspace = await prisma.workspace.findUnique({
      where: { id: item.workspaceId },
      select: { sourcingCostConfig: true },
    });
    return prisma.$transaction(async (tx) => {
      const current = await tx.sourcingCase.findUnique({
        where: { id: caseId },
      });
      if (!current || current.version !== command.version)
        throw new SourcingAccessError(
          "This case has changed. Refresh and try again.",
          409,
        );
      const latest = await tx.sourcingQuote.findFirst({
        where: { caseId },
        orderBy: { revision: "desc" },
      });
      const existing = command.quoteId
        ? await tx.sourcingQuote.findFirst({
            where: { id: command.quoteId, caseId },
            include: { lines: true },
          })
        : null;
      if (command.quoteId && !existing)
        throw new SourcingAccessError("Supplier sheet not found", 404);
      if (!existing) {
        const duplicate = await tx.sourcingQuote.findFirst({
          where: {
            caseId,
            status: { in: ["draft", "submitted"] },
            OR: sheet.supplierId
              ? [{ supplierId: sheet.supplierId }]
              : [{ supplierName: sheet.supplierName }],
          },
        });
        if (duplicate)
          throw new SourcingAccessError(
            "This supplier already has a quote sheet. Select it to continue editing.",
            409,
          );
      }
      const status =
        command.action === "submit_variant_quote" ? "submitted" : "draft";
      let resolvedSupplierId = sheet.supplierId || null;
      if (status === "submitted" && !resolvedSupplierId) {
        const normalizedName = sheet.supplierName.trim();
        const existingSupplier = await tx.supplier.findFirst({
          where: { workspaceId: item.workspaceId, name: normalizedName },
          select: { id: true },
        });
        const supplier =
          existingSupplier ??
          (await tx.supplier.create({
            data: {
              name: normalizedName,
              workspaceId: item.workspaceId,
              userId: actor.id,
              createdBy: actor.id,
              status: true,
            },
            select: { id: true },
          }));
        resolvedSupplierId = supplier.id;
      }
      const quoteGroupId =
        existing?.quoteGroupId || new ObjectId().toHexString();
      const proposalInputs = sheet.proposals ?? [];
      const proposalVariantIds: string[] = [];
      let proposalPosition =
        Math.max(0, ...item.variants.map((variant) => variant.position)) + 1;
      for (const proposal of proposalInputs) {
        if (proposal.caseVariantId) {
          const variant = await tx.sourcingCaseVariant.findFirst({
            where: {
              id: proposal.caseVariantId,
              caseId,
              origin: "sourcer",
              proposedQuoteGroupId: quoteGroupId,
            },
          });
          if (!variant)
            throw new SourcingAccessError(
              "Proposed variant not found for this supplier sheet",
              400,
            );
          proposalVariantIds.push(variant.id);
          continue;
        }
        const created = await tx.sourcingCaseVariant.create({
          data: {
            workspaceId: item.workspaceId,
            caseId,
            position: proposalPosition++,
            size: proposal.size?.trim() || null,
            material: proposal.material?.trim() || null,
            colour: proposal.colour?.trim() || null,
            customLabel: proposal.customLabel?.trim() || null,
            requestedQuantity: 0,
            origin: "sourcer",
            proposedById: actor.id,
            proposedQuoteGroupId: quoteGroupId,
            proposalStatus: "pending",
          },
        });
        proposalVariantIds.push(created.id);
      }
      const staleProposals = await tx.sourcingCaseVariant.findMany({
        where: {
          caseId,
          origin: "sourcer",
          proposedQuoteGroupId: quoteGroupId,
          selection: null,
        },
        select: { id: true },
      });
      for (const stale of staleProposals)
        if (!proposalVariantIds.includes(stale.id))
          await tx.sourcingCaseVariant.delete({ where: { id: stale.id } });
      const proposalLineCreates = proposalInputs
        .map((proposal, index) => {
          const variantId = proposalVariantIds[index];
          if (!variantId) return null;
          const cost = variantViability(
            proposal as unknown as Parameters<typeof variantViability>[0],
            workspace?.sourcingCostConfig,
            {},
          );
          return {
            workspaceId: item.workspaceId,
            caseVariantId: variantId,
            availability: proposal.availability,
            requestedQuantity: 0,
            unitPriceRmb: proposal.unitPriceRmb ?? null,
            piecesPerSellingUnit: proposal.piecesPerSellingUnit ?? null,
            cartonLengthCm: proposal.cartonLengthCm ?? null,
            cartonWidthCm: proposal.cartonWidthCm ?? null,
            cartonHeightCm: proposal.cartonHeightCm ?? null,
            cartonWeightKg: proposal.cartonWeightKg ?? null,
            piecesPerCarton: proposal.piecesPerCarton ?? null,
            moq: proposal.moq ?? null,
            leadTimeDays: proposal.leadTimeDays ?? sheet.leadTimeDays ?? null,
            notes: proposal.notes ?? null,
            costConfigSnapshot: json(
              normalizeSourcingCostConfig(workspace?.sourcingCostConfig),
            ),
            landedCostSnapshot: cost.result ? json(cost.result) : undefined,
          };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null);
      const allLineCreates = [
        ...sheet.lines.map((line) => {
          const variant = variantsById.get(line.caseVariantId)!;
          const cost = variantViability(
            line,
            workspace?.sourcingCostConfig,
            variant,
          );
          return {
            workspaceId: item.workspaceId,
            caseVariantId: variant.id,
            availability: line.availability,
            size: variant.size,
            material: variant.material,
            colour: variant.colour,
            requestedQuantity: variant.requestedQuantity,
            unitPriceRmb: line.unitPriceRmb ?? null,
            piecesPerSellingUnit: line.piecesPerSellingUnit ?? null,
            cartonLengthCm: line.cartonLengthCm ?? null,
            cartonWidthCm: line.cartonWidthCm ?? null,
            cartonHeightCm: line.cartonHeightCm ?? null,
            cartonWeightKg: line.cartonWeightKg ?? null,
            piecesPerCarton: line.piecesPerCarton ?? null,
            overrideCostMyr: line.overrideCostMyr ?? null,
            moq: line.moq ?? null,
            leadTimeDays: line.leadTimeDays ?? sheet.leadTimeDays ?? null,
            notes: line.notes ?? null,
            costConfigSnapshot: json(
              normalizeSourcingCostConfig(workspace?.sourcingCostConfig),
            ),
            landedCostSnapshot: cost.result ? json(cost.result) : undefined,
          };
        }),
        ...proposalLineCreates,
      ];
      const quoteData = {
        supplierId: resolvedSupplierId,
        supplierName: sheet.supplierName,
        currency: "CNY",
        items: json(
          sheet.lines.map((line) => {
            const variant = variantsById.get(line.caseVariantId)!;
            return {
              name: `${item.title} - ${variantLabel(variant)}`,
              sku: `SRC-${variant.id}`,
              quantity: variant.requestedQuantity,
              unitCost: line.unitPriceRmb ?? 0,
            };
          }),
        ),
        paymentTerms: sheet.paymentTerms || null,
        leadTimeDays: sheet.leadTimeDays ?? null,
        notes: sheet.notes || null,
        lines: {
          create: allLineCreates,
        },
      };
      const quote =
        existing?.status === "draft"
          ? await tx.sourcingQuote.update({
              where: { id: existing.id },
              data: {
                ...quoteData,
                status,
                lines: { deleteMany: {}, create: quoteData.lines.create },
              },
              include: { lines: true },
            })
          : await tx.sourcingQuote.create({
              data: {
                workspaceId: item.workspaceId,
                caseId,
                quoteGroupId,
                revision: (latest?.revision ?? 0) + 1,
                status,
                createdById: actor.id,
                ...quoteData,
              },
              include: { lines: true },
            });
      if (
        existing &&
        ["submitted", "changes_requested"].includes(existing.status) &&
        status === "submitted"
      )
        await tx.sourcingQuote.update({
          where: { id: existing.id },
          data: { status: "superseded" },
        });
      await tx.sourcingCase.update({
        where: { id: caseId },
        data: {
          stage: status === "submitted" ? "quoted" : item.stage,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      await tx.sourcingEvent.create({
        data: {
          workspaceId: item.workspaceId,
          caseId,
          actorId: actor.id,
          type:
            status === "submitted"
              ? "variant_quote_submitted"
              : "variant_quote_saved",
          payload: json({
            quoteId: quote.id,
            supplierName: quote.supplierName,
          }),
        },
      });
      return { ...quote, proposalVariantIds };
    });
  }
  if (!canAdmin)
    throw new SourcingAccessError(
      "Only workspace admins can make selections",
      403,
    );
  if (
    [
      "update_case_variant",
      "add_case_variant",
      "remove_case_variant",
      "dismiss_variant_proposal",
    ].includes(command.action)
  ) {
    if (
      !["draft", "sourcing", "changes_requested", "quoted"].includes(item.stage)
    )
      throw new SourcingAccessError(
        "Variants cannot be changed at this stage",
        409,
      );
    const submittedQuoteCount = await prisma.sourcingQuote.count({
      where: { caseId, status: { in: ["submitted", "changes_requested"] } },
    });
    if (
      ["add_case_variant", "remove_case_variant"].includes(command.action) &&
      submittedQuoteCount > 0
    )
      throw new SourcingAccessError(
        "Variant structure is locked after supplier offers are submitted",
        409,
      );
    return prisma.$transaction(async (tx) => {
      const current = await tx.sourcingCase.findUnique({
        where: { id: caseId },
      });
      if (!current || current.version !== command.version)
        throw new SourcingAccessError(
          "This case has changed. Refresh and try again.",
          409,
        );
      if (command.action === "add_case_variant") {
        const input = command.newVariant!;
        const last = await tx.sourcingCaseVariant.findFirst({
          where: { caseId },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        await tx.sourcingCaseVariant.create({
          data: {
            workspaceId: item.workspaceId,
            caseId,
            position: (last?.position ?? -1) + 1,
            size: input.size?.trim() || null,
            material: input.material?.trim() || null,
            colour: input.colour?.trim() || null,
            requestedQuantity: input.requestedQuantity ?? undefined,
            targetUnitPriceMyr: input.targetUnitPriceMyr ?? null,
            marketPriceMyr: input.marketPriceMyr ?? null,
            marketPack: input.marketPack ?? 1,
            requestQuote: input.requestQuote ?? true,
            productUrl: input.productUrl?.trim() || null,
            remarks: input.remarks?.trim() || null,
          },
        });
      } else if (command.action === "remove_case_variant") {
        const variant = await tx.sourcingCaseVariant.findFirst({
          where: { id: command.caseVariantId, caseId, origin: "admin" },
          select: { id: true },
        });
        if (!variant) throw new SourcingAccessError("Variant not found", 404);
        await tx.sourcingCaseVariant.delete({ where: { id: variant.id } });
      } else if (command.action === "dismiss_variant_proposal") {
        const variant = await tx.sourcingCaseVariant.findFirst({
          where: { id: command.caseVariantId, caseId, origin: "sourcer" },
          select: { id: true },
        });
        if (!variant) throw new SourcingAccessError("Proposal not found", 404);
        await tx.sourcingCaseVariant.update({
          where: { id: variant.id },
          data: { proposalStatus: "dismissed", requestQuote: false },
        });
        await tx.sourcingVariantSelection.deleteMany({
          where: { caseId, caseVariantId: variant.id },
        });
      } else {
        const input = command.variant!;
        const variant = await tx.sourcingCaseVariant.findFirst({
          where: { id: input.caseVariantId, caseId },
          select: { id: true, origin: true },
        });
        if (!variant) throw new SourcingAccessError("Variant not found", 404);
        await tx.sourcingCaseVariant.update({
          where: { id: variant.id },
          data: {
            size:
              input.size === undefined ? undefined : input.size?.trim() || null,
            material:
              input.material === undefined
                ? undefined
                : input.material?.trim() || null,
            colour:
              input.colour === undefined
                ? undefined
                : input.colour?.trim() || null,
            requestedQuantity: input.requestedQuantity ?? undefined,
            marketPriceMyr:
              input.marketPriceMyr === undefined
                ? undefined
                : input.marketPriceMyr,
            marketPack: input.marketPack ?? undefined,
            requestQuote: input.requestQuote,
            productUrl:
              input.productUrl === undefined
                ? undefined
                : input.productUrl?.trim() || null,
            remarks:
              input.remarks === undefined
                ? undefined
                : input.remarks?.trim() || null,
          },
        });
      }
      return tx.sourcingCase.update({
        where: { id: caseId },
        data: { version: { increment: 1 }, updatedAt: new Date() },
      });
    });
  }
  if (
    ["save_variant_selection", "clear_variant_selection"].includes(
      command.action,
    )
  ) {
    if (item.stage !== "quoted")
      throw new SourcingAccessError(
        "Variant decisions can only be changed during review",
        409,
      );
    const caseVariantId =
      command.selection?.caseVariantId || command.caseVariantId!;
    const variant = item.variants.find((entry) => entry.id === caseVariantId);
    if (!variant)
      throw new SourcingAccessError("Unknown variant selection", 400);
    if (variant.requestQuote === false)
      throw new SourcingAccessError(
        "This variant was not sent for quoting",
        409,
      );
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.sourcingCase.findUnique({
        where: { id: caseId },
      });
      if (!current || current.version !== command.version)
        throw new SourcingAccessError(
          "This case has changed. Refresh and try again.",
          409,
        );
      if (command.action === "clear_variant_selection") {
        await tx.sourcingVariantSelection.deleteMany({
          where: { caseId, caseVariantId },
        });
      } else {
        const selection = command.selection!;
        const line = await tx.sourcingQuoteLine.findFirst({
          where: {
            id: selection.quoteLineId,
            caseVariantId,
            workspaceId: item.workspaceId,
          },
          include: { quote: true },
        });
        if (
          !line ||
          line.quote.status !== "submitted" ||
          line.availability !== "available" ||
          line.reviewStatus === "rejected"
        )
          throw new SourcingAccessError(
            "Selected offer is no longer available",
            409,
          );
        if (variant.origin === "sourcer" && variant.requestedQuantity <= 0)
          throw new SourcingAccessError(
            "Set a quantity before selecting a sourcer-added variant",
            409,
          );
        const workspace = await tx.workspace.findUnique({
          where: { id: item.workspaceId },
          select: { sourcingCostConfig: true },
        });
        const market = {
          marketPriceMyr: selection.marketPriceMyr ?? variant.marketPriceMyr,
          marketPack: selection.marketPack ?? variant.marketPack,
        };
        const viability = variantViability(
          line,
          workspace?.sourcingCostConfig,
          market,
        );
        if (!["pass", "market_unchecked"].includes(viability.status))
          throw new SourcingAccessError("Selected offer is not viable", 409);
        await tx.sourcingCaseVariant.update({
          where: { id: caseVariantId },
          data: {
            marketPriceMyr: selection.marketPriceMyr ?? null,
            marketPack: selection.marketPriceMyr
              ? (selection.marketPack ?? 1)
              : null,
          },
        });
        await tx.sourcingVariantSelection.upsert({
          where: { caseVariantId },
          create: {
            workspaceId: item.workspaceId,
            caseId,
            caseVariantId,
            quoteLineId: line.id,
            orderQuantity: selection.orderQuantity,
            status: "selected",
            marketValidationWaived: !selection.marketPriceMyr,
            decidedById: actor.id,
          },
          update: {
            quoteLineId: line.id,
            orderQuantity: selection.orderQuantity,
            status: "selected",
            skipReason: null,
            marketValidationWaived: !selection.marketPriceMyr,
            decidedById: actor.id,
            decidedAt: new Date(),
          },
        });
        if (variant.origin === "sourcer")
          await tx.sourcingCaseVariant.update({
            where: { id: caseVariantId },
            data: { proposalStatus: "accepted" },
          });
      }
      return tx.sourcingCase.update({
        where: { id: caseId },
        data: { version: { increment: 1 }, updatedAt: new Date() },
      });
    });
    return updated;
  }
  if (command.action === "reject_variant_offer") {
    if (item.stage !== "quoted")
      throw new SourcingAccessError(
        "Supplier offers can only be rejected during review",
        409,
      );
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.sourcingCase.findUnique({
        where: { id: caseId },
      });
      if (!current || current.version !== command.version)
        throw new SourcingAccessError(
          "This case has changed. Refresh and try again.",
          409,
        );
      const offer = await tx.sourcingQuoteLine.findFirst({
        where: {
          id: command.quoteLineId,
          quote: { caseId, status: "submitted" },
        },
      });
      if (!offer)
        throw new SourcingAccessError(
          "Submitted supplier offer not found",
          404,
        );
      await tx.sourcingQuoteLine.update({
        where: { id: offer.id },
        data: { reviewStatus: "rejected" },
      });
      await tx.sourcingVariantSelection.deleteMany({
        where: { caseVariantId: offer.caseVariantId, quoteLineId: offer.id },
      });
      return tx.sourcingCase.update({
        where: { id: caseId },
        data: { version: { increment: 1 }, updatedAt: new Date() },
      });
    });
    return updated;
  }
  if (command.action === "request_variant_quote_changes") {
    if (item.stage !== "quoted")
      throw new SourcingAccessError(
        "Supplier corrections can only be requested during review",
        409,
      );
    const workspace = await prisma.workspace.findUnique({
      where: { id: item.workspaceId },
      select: { sourcingCostConfig: true },
    });
    const quote = await prisma.sourcingQuote.findFirst({
      where: { id: command.quoteId, caseId, status: "submitted" },
      include: { lines: { include: { caseVariant: true } } },
    });
    if (!quote)
      throw new SourcingAccessError("Submitted supplier offer not found", 404);
    const requestedLine = command.quoteLineId
      ? quote.lines.find((line) => line.id === command.quoteLineId)
      : undefined;
    if (command.quoteLineId && !requestedLine)
      throw new SourcingAccessError("Supplier offer not found", 404);
    const issues = requestedLine
      ? [
          {
            variantId: requestedLine.caseVariantId,
            variant: variantLabel(requestedLine.caseVariant),
            fields: [command.reason!],
          },
        ]
      : quote.lines.flatMap((line) => {
          const evaluation = variantViability(
            line,
            workspace?.sourcingCostConfig,
            line.caseVariant,
          );
          if (evaluation.status !== "needs_data") return [];
          const fields = evaluation.result?.flags.includes("freight_excluded")
            ? ["carton dimensions", "pieces per carton"]
            : ["quoted cost details"];
          return [
            {
              variantId: line.caseVariantId,
              variant: variantLabel(line.caseVariant),
              fields,
            },
          ];
        });
    if (!issues.length)
      throw new SourcingAccessError(
        "This offer has no missing supplier information",
        409,
      );
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.sourcingCase.findUnique({
        where: { id: caseId },
      });
      if (!current || current.version !== command.version)
        throw new SourcingAccessError(
          "This case has changed. Refresh and try again.",
          409,
        );
      await tx.sourcingQuote.update({
        where: { id: quote.id },
        data: { status: "changes_requested" },
      });
      const next = await tx.sourcingCase.update({
        where: { id: caseId },
        data: {
          stage: "changes_requested",
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      await tx.sourcingEvent.create({
        data: {
          workspaceId: item.workspaceId,
          caseId,
          actorId: actor.id,
          type: "variant_quote_changes_requested",
          payload: json({
            quoteId: quote.id,
            supplierName: quote.supplierName,
            issues,
          }),
        },
      });
      return next;
    });
    if (item.assignedToId)
      void deliverSourcingNotification({
        workspaceId: item.workspaceId,
        caseId,
        recipientIds: [item.assignedToId],
        excludeUserId: actor.id,
        kind: "decision",
        title: "Supplier quote needs correction",
        message: `${quote.supplierName} is missing shipping information for ${issues.length} variant${issues.length === 1 ? "" : "s"} in ${item.title}.`,
        dedupeKey: `variant_quote_changes:${caseId}:${quote.id}:${updated.version}`,
        metadata: {
          quoteId: quote.id,
          supplierName: quote.supplierName,
          issues,
        },
      }).catch((error) =>
        logger.error(
          "[Sourcing] Variant correction notification failed",
          error,
        ),
      );
    return updated;
  }
  if (command.action === "confirm_variant_selection") {
    const requiredVariants = item.variants.filter(
      (variant) => variant.requestQuote !== false && variant.origin === "admin",
    );
    if (
      !command.selections ||
      new Set(command.selections.map((selection) => selection.caseVariantId))
        .size !== command.selections.length ||
      requiredVariants.some(
        (variant) =>
          !command.selections!.some(
            (selection) => selection.caseVariantId === variant.id,
          ),
      )
    )
      throw new SourcingAccessError(
        "Choose or skip every requested variant",
        400,
      );
    const variantsById = new Map(
      item.variants.map((variant) => [variant.id, variant]),
    );
    const variantIds = new Set(variantsById.keys());
    if (
      command.selections.some(
        (selection) =>
          !variantIds.has(selection.caseVariantId) ||
          variantsById.get(selection.caseVariantId)!.requestQuote === false,
      )
    )
      throw new SourcingAccessError("Unknown variant selection", 400);
    const workspace = await prisma.workspace.findUnique({
      where: { id: item.workspaceId },
      select: { sourcingCostConfig: true },
    });
    const selectedLineIds = command.selections.flatMap((selection) =>
      selection.quoteLineId ? [selection.quoteLineId] : [],
    );
    const lines = await prisma.sourcingQuoteLine.findMany({
      where: { id: { in: selectedLineIds }, workspaceId: item.workspaceId },
      include: { quote: true },
    });
    const linesById = new Map(lines.map((line) => [line.id, line]));
    for (const selection of command.selections) {
      if (!selection.quoteLineId) continue;
      const line = linesById.get(selection.quoteLineId);
      if (
        !line ||
        line.caseVariantId !== selection.caseVariantId ||
        line.quote.status !== "submitted"
      )
        throw new SourcingAccessError(
          "Selected offer is no longer available",
          409,
        );
      const variant = variantsById.get(line.caseVariantId)!;
      const market = {
        marketPriceMyr: selection.marketPriceMyr ?? variant.marketPriceMyr,
        marketPack: selection.marketPack ?? variant.marketPack,
      };
      const viability = variantViability(
        line,
        workspace?.sourcingCostConfig,
        market,
      );
      if (viability.status === "needs_data" || viability.status === "fail")
        throw new SourcingAccessError("Selected offer is not viable", 409);
    }
    const autoSkippedSelections = item.variants
      .filter((variant) => variant.requestQuote === false)
      .map((variant) => ({
        caseVariantId: variant.id,
        status: "skipped" as const,
        skipReason: "Not sent for quoting",
        marketPriceMyr: undefined,
        marketPack: undefined,
      }));
    const finalSelections = [...command.selections, ...autoSkippedSelections];
    return prisma.$transaction(async (tx) => {
      const current = await tx.sourcingCase.findUnique({
        where: { id: caseId },
      });
      if (!current || current.version !== command.version)
        throw new SourcingAccessError(
          "This case has changed. Refresh and try again.",
          409,
        );
      await Promise.all(
        finalSelections.map((selection) =>
          tx.sourcingCaseVariant.update({
            where: { id: selection.caseVariantId },
            data: {
              marketPriceMyr: selection.marketPriceMyr ?? null,
              marketPack: selection.marketPriceMyr
                ? (selection.marketPack ?? 1)
                : null,
            },
          }),
        ),
      );
      await tx.sourcingVariantSelection.deleteMany({ where: { caseId } });
      await tx.sourcingVariantSelection.createMany({
        data: finalSelections.map((selection) => ({
          workspaceId: item.workspaceId,
          caseId,
          caseVariantId: selection.caseVariantId,
          quoteLineId:
            selection.status === "selected" ? selection.quoteLineId : null,
          status: selection.status,
          skipReason:
            selection.status === "skipped"
              ? selection.skipReason || null
              : null,
          marketValidationWaived:
            selection.status === "selected" && !selection.marketPriceMyr,
          decidedById: actor.id,
        })),
      });
      const updated = await tx.sourcingCase.update({
        where: { id: caseId },
        data: {
          stage: "approved",
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      await tx.sourcingEvent.create({
        data: {
          workspaceId: item.workspaceId,
          caseId,
          actorId: actor.id,
          type: "variant_selection_confirmed",
        },
      });
      return updated;
    });
  }
  if (command.action !== "create_variant_orders")
    throw new SourcingAccessError("Unknown variant sourcing command", 400);
  if (item.stage !== "approved")
    throw new SourcingAccessError(
      "Confirm selections before creating purchase orders",
      409,
    );
  return prisma.$transaction(async (tx) => {
    const current = await tx.sourcingCase.findUnique({
      where: { id: caseId },
      include: {
        selections: {
          include: {
            quoteLine: { include: { quote: true, caseVariant: true } },
          },
        },
      },
    });
    if (!current || current.version !== command.version)
      throw new SourcingAccessError(
        "This case has changed. Refresh and try again.",
        409,
      );
    const selected = current.selections.filter(
      (selection) => selection.status === "selected" && selection.quoteLine,
    );
    if (!selected.length)
      throw new SourcingAccessError(
        "Select at least one variant before creating purchase orders",
        409,
      );
    const byQuote = new Map<string, typeof selected>();
    for (const selection of selected) {
      const quoteId = selection.quoteLine!.quoteId;
      byQuote.set(quoteId, [...(byQuote.get(quoteId) || []), selection]);
    }
    const purchaseOrderIds: string[] = [];
    for (const [quoteId, selections] of byQuote) {
      const header = selections[0]!.quoteLine!.quote;
      let supplier = header.supplierId
        ? await tx.supplier.findFirst({
            where: { id: header.supplierId, workspaceId: current.workspaceId },
          })
        : await tx.supplier.findFirst({
            where: {
              name: header.supplierName,
              workspaceId: current.workspaceId,
            },
          });
      if (!supplier)
        supplier = await tx.supplier.create({
          data: {
            name: header.supplierName,
            workspaceId: current.workspaceId,
            userId: actor.id,
            createdBy: actor.id,
            status: true,
          },
        });
      const poLines = [] as {
        productId: string;
        productName: string;
        sku: string;
        quantity: number;
        unitCost: number;
        variantId: string;
        quoteLineId: string;
      }[];
      for (const selection of selections) {
        const line = selection.quoteLine!;
        const variant = line.caseVariant;
        const sku = `SRC-${variant.id}`;
        const productName = `${current.title} - ${variantLabel(variant)}`;
        let product = await tx.product.findFirst({
          where: { sku, workspaceId: current.workspaceId },
        });
        if (!product) {
          let category = await tx.category.findFirst({
            where: { workspaceId: current.workspaceId, status: true },
            orderBy: { createdAt: "asc" },
          });
          if (!category)
            category = await tx.category.create({
              data: {
                name: "Sourced",
                workspaceId: current.workspaceId,
                userId: actor.id,
                createdBy: actor.id,
                status: true,
              },
            });
          product = await tx.product.create({
            data: {
              name: productName,
              sku,
              skuScopeId: current.workspaceId,
              price: 0,
              quantity: BigInt(0),
              status: "active",
              categoryId: category.id,
              supplierId: supplier.id,
              userId: actor.id,
              createdBy: actor.id,
              workspaceId: current.workspaceId,
            },
          });
        }
        poLines.push({
          productId: product.id,
          productName,
          sku,
          quantity: Math.max(
            selection.orderQuantity ?? variant.requestedQuantity,
            line.moq ?? 0,
          ),
          unitCost: line.unitPriceRmb ?? 0,
          variantId: variant.id,
          quoteLineId: line.id,
        });
      }
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber: `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          supplierId: supplier.id,
          userId: actor.id,
          workspaceId: current.workspaceId,
          status: "approved",
          currency: "CNY",
          totalAmount: poLines.reduce(
            (total, line) => total + line.quantity * line.unitCost,
            0,
          ),
          createdBy: actor.id,
          items: {
            create: poLines.map((line) => ({
              productId: line.productId,
              productName: line.productName,
              sku: line.sku,
              quantity: line.quantity,
              unitCost: line.unitCost,
              subtotal: line.quantity * line.unitCost,
              sourcingCaseVariantId: line.variantId,
              sourcingQuoteLineId: line.quoteLineId,
            })),
          },
        },
      });
      await tx.sourcingOrder.create({
        data: {
          workspaceId: current.workspaceId,
          caseId,
          quoteId,
          purchaseOrderId: po.id,
          createdById: actor.id,
        },
      });
      purchaseOrderIds.push(po.id);
    }
    const updated = await tx.sourcingCase.update({
      where: { id: caseId },
      data: {
        stage: "order_pending",
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    await tx.sourcingEvent.create({
      data: {
        workspaceId: current.workspaceId,
        caseId,
        actorId: actor.id,
        type: "variant_orders_created",
        payload: json({ purchaseOrderIds }),
      },
    });
    return { ...updated, purchaseOrderIds };
  });
}
