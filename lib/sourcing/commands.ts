import { Prisma, type SourcingCase, type SourcingQuote } from "@prisma/client";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { deliverSourcingNotification, sourcingAdmins } from "./notifications";
import { requireWorkspaceRole, SourcingAccessError } from "./auth";
import type {
  SourcingCaseInput,
  SourcingNextActionInput,
  SourcingQuoteInput,
} from "@/lib/validations/sourcing";
import { canEditQuote, quoteGroupKey } from "./workflow";
import { ObjectId } from "mongodb";
import { convertMoney } from "@/lib/money";
import {
  getOrRefreshExchangeRate,
  isExchangeRateFresh,
} from "@/lib/exchange-rates/service";
import {
  completeSourcingSla,
  dueAtForSourcingSla,
  normalizeSourcingSlaConfig,
  type SourcingSlaConfig,
} from "./sla";
import {
  calculateSourcingLandedCost,
  normalizeSourcingCostConfig,
} from "./landed-cost";

type Actor = {
  id: string;
  role: string | null;
  isSuperAdmin?: boolean;
  email: string;
  name: string;
};
type QuoteItem = {
  name: string;
  sku: string;
  quantity: number;
  unitCost: number;
  productId?: string;
  categoryId?: string;
};
type Command = {
  action:
    | "assign"
    | "create_quote"
    | "save_quote"
    | "submit_quote"
    | "submit_all_drafts"
    | "delete_quote"
    | "withdraw_quote"
    | "request_changes"
    | "approve"
    | "reject"
    | "cannot_source"
    | "confirm_order"
    | "approve_and_create_order"
    | "cancel"
    | "archive"
    | "revive"
    | "repeat";
  version: number;
  assigneeId?: string;
  quoteId?: string;
  fxRateOverride?: number;
  fxOverrideReason?: string;
  orderQuantity?: number;
  quote?: SourcingQuoteInput;
  reason?: string;
};

const editableStages = ["draft", "sourcing", "changes_requested"];
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const event = (
  tx: Prisma.TransactionClient,
  caseId: string,
  workspaceId: string,
  actorId: string,
  type: string,
  payload?: unknown,
) =>
  tx.sourcingEvent.create({
    data: {
      caseId,
      workspaceId,
      actorId,
      type,
      payload: payload ? json(payload) : undefined,
    },
  });

type OrderCase = Pick<SourcingCase, "assignedToId" | "workspaceId">;
type OrderQuote = Pick<
  SourcingQuote,
  | "currency"
  | "fxProvider"
  | "fxRate"
  | "fxRateDate"
  | "id"
  | "items"
  | "landedCostSnapshot"
  | "moq"
  | "supplierId"
  | "supplierName"
  | "unitPriceMyr"
>;

async function createOrderFromApprovedQuote(
  tx: Prisma.TransactionClient,
  actor: Actor,
  item: OrderCase,
  caseId: string,
  quote: OrderQuote,
  slaConfig: SourcingSlaConfig,
  orderQuantity?: number,
) {
  const lines = quote.items as unknown as QuoteItem[];
  if (orderQuantity && lines.length !== 1)
    throw new SourcingAccessError(
      "Order quantity can only be changed for a single-item sourcing request",
      409,
    );
  if (orderQuantity && quote.moq && orderQuantity < quote.moq)
    throw new SourcingAccessError(
      `Order quantity must be at least the supplier minimum of ${quote.moq}`,
      400,
    );
  let supplier = quote.supplierId
    ? await tx.supplier.findFirst({
        where: { id: quote.supplierId, workspaceId: item.workspaceId },
      })
    : await tx.supplier.findFirst({
        where: { name: quote.supplierName, workspaceId: item.workspaceId },
      });
  if (!supplier) {
    supplier = await tx.supplier.create({
      data: {
        name: quote.supplierName,
        workspaceId: item.workspaceId,
        userId: actor.id,
        createdBy: actor.id,
        status: true,
      },
    });
  }
  const products = [] as {
    id: string;
    name: string;
    sku: string;
    quantity: number;
    unitCost: number;
  }[];
  for (const line of lines) {
    let product = line.productId
      ? await tx.product.findFirst({
          where: { id: line.productId, workspaceId: item.workspaceId },
        })
      : await tx.product.findFirst({
          where: { sku: line.sku, workspaceId: item.workspaceId },
        });
    if (!product) {
      let category = line.categoryId
        ? await tx.category.findFirst({
            where: {
              id: line.categoryId,
              workspaceId: item.workspaceId,
              status: true,
            },
          })
        : await tx.category.findFirst({
            where: { workspaceId: item.workspaceId, status: true },
            orderBy: { createdAt: "asc" },
          });
      if (!category) {
        category = await tx.category.create({
          data: {
            name: "Sourced",
            workspaceId: item.workspaceId,
            userId: actor.id,
            createdBy: actor.id,
            status: true,
          },
        });
      }
      product = await tx.product.create({
        data: {
          name: line.name,
          sku: line.sku,
          skuScopeId: item.workspaceId,
          price: 0,
          quantity: BigInt(0),
          status: "active",
          categoryId: category.id,
          supplierId: supplier.id,
          userId: actor.id,
          createdBy: actor.id,
          workspaceId: item.workspaceId,
        },
      });
    }
    products.push({
      id: product.id,
      name: line.name,
      sku: line.sku,
      quantity: orderQuantity ?? line.quantity,
      unitCost: line.unitCost,
    });
  }
  const poNumber = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const po = await tx.purchaseOrder.create({
    data: {
      poNumber,
      supplierId: supplier.id,
      userId: actor.id,
      workspaceId: item.workspaceId,
      status: "ordered",
      currency: quote.currency,
      convertedTotalMyr:
        quote.unitPriceMyr == null
          ? null
          : products.reduce(
              (total, line) => total + line.quantity * quote.unitPriceMyr!,
              0,
            ),
      fxRate: quote.fxRate,
      fxRateDate: quote.fxRateDate,
      fxProvider: quote.fxProvider,
      totalAmount: products.reduce(
        (total, line) => total + line.quantity * line.unitCost,
        0,
      ),
      createdBy: actor.id,
      orderedAt: new Date(),
      items: {
        create: products.map((line) => ({
          productId: line.id,
          productName: line.name,
          sku: line.sku,
          quantity: line.quantity,
          unitCost: line.unitCost,
          subtotal: line.quantity * line.unitCost,
        })),
      },
    },
  });
  await tx.sourcingOrder.create({
    data: {
      workspaceId: item.workspaceId,
      caseId,
      quoteId: quote.id,
      purchaseOrderId: po.id,
      landedCostSnapshot: quote.landedCostSnapshot ?? undefined,
      createdById: actor.id,
    },
  });
  const now = new Date();
  const shipmentDueAt = dueAtForSourcingSla("shipment", now, slaConfig);
  await tx.sourcingSlaRecord.create({
    data: {
      workspaceId: item.workspaceId,
      caseId,
      rule: "shipment",
      ownerId: item.assignedToId,
      startedAt: now,
      dueAt: shipmentDueAt,
    },
  });
  return { purchaseOrderId: po.id, shipmentDueAt };
}

function assertVersion(version: number, expected: number) {
  if (version !== expected)
    throw new SourcingAccessError(
      "This case has changed. Refresh and try again.",
      409,
    );
}

const listInclude = {
  quotes: { orderBy: { revision: "desc" as const }, take: 1 },
  orders: true,
  variants: { orderBy: { position: "asc" as const } },
};

export async function createSourcingCase(
  actor: Actor,
  input: SourcingCaseInput,
) {
  const access = await requireWorkspaceRole(actor, input.workspaceId, [
    "admin",
    "sourcer",
  ]);
  if (!input.title.trim())
    throw new SourcingAccessError("Title is required", 400);
  const assignedToId =
    input.assignedToId || (access.role === "sourcer" ? actor.id : null);
  const requestedVariants = input.variants.length
    ? input.variants
    : [{ size: null, material: null, colour: null, targetUnitPriceMyr: null, requestedQuantity: input.requestedQuantity ?? 1 }];
  if (assignedToId) {
    if (input.assignedToId && !access.globalAdmin && access.role !== "admin")
      throw new SourcingAccessError("Only workspace admins can assign cases");
    const sourcer = await prisma.user.findFirst({
      where: { id: assignedToId, role: "sourcer", status: "approved" },
      select: { id: true },
    });
    if (!sourcer)
      throw new SourcingAccessError(
        "Assignee must be an approved Sourcer",
        400,
      );
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { sourcingSlaConfig: true },
  });
  const slaConfig = normalizeSourcingSlaConfig(workspace?.sourcingSlaConfig);
  const startedAt = new Date();
  const firstResponseDueAt = dueAtForSourcingSla(
    "first_response",
    startedAt,
    slaConfig,
  );
  const quoteDueAt = dueAtForSourcingSla(
    "quote_submission",
    startedAt,
    slaConfig,
  );
  const sourcingCase = await prisma.$transaction(async (tx) => {
    const created = await tx.sourcingCase.create({
      data: {
        workspaceId: input.workspaceId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        photoUrls: json(input.photoUrls),
        size: input.size?.trim() || null,
        material: input.material?.trim() || null,
        variant: input.variant?.trim() || null,
        specifications: input.specifications?.trim() || null,
        referenceUrl: input.referenceUrl?.trim() || null,
        notes: input.notes?.trim() || null,
        requestedQuantity: input.requestedQuantity ?? null,
        targetUnitPriceMyr: input.targetUnitPriceMyr ?? null,
        variants: {
          create: requestedVariants.map((variant, position) => ({
            workspaceId: input.workspaceId,
            position,
            size: variant.size?.trim() || null,
            material: variant.material?.trim() || null,
            colour: variant.colour?.trim() || null,
            requestedQuantity: variant.requestedQuantity,
            targetUnitPriceMyr: variant.targetUnitPriceMyr ?? null,
          })),
        },
        assignedToId,
        createdById: actor.id,
        stage: assignedToId ? "sourcing" : "draft",
        slaDueAt: assignedToId ? quoteDueAt : firstResponseDueAt,
        slaRule: assignedToId ? "quote_submission" : "first_response",
      },
      include: listInclude,
    });
    await tx.sourcingSlaRecord.create({
      data: {
        workspaceId: input.workspaceId,
        caseId: created.id,
        rule: "first_response",
        ownerId: assignedToId,
        startedAt,
        dueAt: firstResponseDueAt,
        completedAt: assignedToId ? startedAt : null,
        onTime: assignedToId ? true : null,
      },
    });
    if (assignedToId)
      await tx.sourcingSlaRecord.create({
        data: {
          workspaceId: input.workspaceId,
          caseId: created.id,
          rule: "quote_submission",
          ownerId: assignedToId,
          startedAt,
          dueAt: quoteDueAt,
        },
      });
    await event(tx, created.id, input.workspaceId, actor.id, "case_created", {
      assignedToId,
    });
    return created;
  });
  if (assignedToId) {
    void deliverSourcingNotification({
      workspaceId: input.workspaceId,
      caseId: sourcingCase.id,
      recipientIds: [assignedToId],
      excludeUserId: actor.id,
      kind: "assignment",
      title: "Sourcing case assigned",
      message: `${actor.name} assigned you to ${sourcingCase.title}.`,
      dedupeKey: `case_created:${sourcingCase.id}:${assignedToId}`,
    }).catch((error) =>
      logger.error("[Sourcing] Assignment notification delivery failed", error),
    );
  }
  return sourcingCase;
}

export async function updateSourcingNextAction(
  actor: Actor,
  caseId: string,
  input: SourcingNextActionInput,
) {
  const current = await prisma.sourcingCase.findUnique({
    where: { id: caseId },
  });
  if (!current) throw new SourcingAccessError("Sourcing case not found", 404);
  const access = await requireWorkspaceRole(actor, current.workspaceId, [
    "admin",
    "sourcer",
  ]);
  if (
    !access.globalAdmin &&
    access.role !== "admin" &&
    current.assignedToId !== actor.id
  ) {
    throw new SourcingAccessError(
      "Only the assigned sourcer can update this case",
    );
  }

  return prisma.$transaction(async (tx) => {
    const item = await tx.sourcingCase.findUnique({ where: { id: caseId } });
    if (!item) throw new SourcingAccessError("Sourcing case not found", 404);
    assertVersion(input.version, item.version);
    const updated = await tx.sourcingCase.update({
      where: { id: caseId },
      data: {
        nextAction: input.nextAction?.trim() || null,
        nextActionAt: input.nextActionAt ?? null,
        slaDueAt: input.slaDueAt ?? null,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (input.slaDueAt) {
      await tx.sourcingSlaRecord.updateMany({
        where: { caseId, completedAt: null },
        data: { dueAt: input.slaDueAt },
      });
    }
    await event(tx, caseId, item.workspaceId, actor.id, "next_action_updated", {
      nextAction: updated.nextAction,
      nextActionAt: updated.nextActionAt,
      slaDueAt: updated.slaDueAt,
    });
    return updated;
  });
}

export async function runSourcingCommand(
  actor: Actor,
  caseId: string,
  command: Command,
) {
  const current = await prisma.sourcingCase.findUnique({
    where: { id: caseId },
  });
  if (!current) throw new SourcingAccessError("Sourcing case not found", 404);
  const workspace = await prisma.workspace.findUnique({
    where: { id: current.workspaceId },
    select: { sourcingSlaConfig: true, sourcingCostConfig: true },
  });
  const slaConfig = normalizeSourcingSlaConfig(workspace?.sourcingSlaConfig);
  const costConfig = normalizeSourcingCostConfig(workspace?.sourcingCostConfig);
  const access = await requireWorkspaceRole(actor, current.workspaceId, [
    "admin",
    "sourcer",
  ]);
  // Fetch outside the workflow transaction: a provider/cache read must not hold
  // a MongoDB transaction open, and the snapshot is persisted on approval.
  const approvalReferenceRate =
    ["approve", "approve_and_create_order"].includes(command.action) &&
    !command.fxRateOverride
      ? await getOrRefreshExchangeRate("CNY", "MYR")
      : null;
  const requireAssigned = () => {
    if (
      !canEditQuote(
        access.role,
        access.globalAdmin,
        current.assignedToId,
        actor.id,
        current.stage,
      )
    )
      throw new SourcingAccessError(
        "Only the assigned sourcer can update this case",
      );
  };

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.sourcingCase.findUnique({ where: { id: caseId } });
    if (!item) throw new SourcingAccessError("Sourcing case not found", 404);
    assertVersion(command.version, item.version);
    const bump = (data: Prisma.SourcingCaseUpdateInput) =>
      tx.sourcingCase.update({
        where: { id: caseId },
        data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
      });

    if (command.action === "assign") {
      if (access.role !== "admin" && !access.globalAdmin)
        throw new SourcingAccessError("Only workspace admins can assign cases");
      if (!command.assigneeId)
        throw new SourcingAccessError("Assignee is required", 400);
      const sourcer = await tx.user.findFirst({
        where: {
          id: command.assigneeId,
          role: "sourcer",
          status: "approved",
        },
        select: { id: true },
      });
      if (!sourcer)
        throw new SourcingAccessError(
          "Assignee must be an approved Sourcer",
          400,
        );
      const now = new Date();
      let slaData: Prisma.SourcingCaseUpdateInput = {};
      if (!item.assignedToId) {
        await completeSourcingSla(tx, caseId, "first_response", now);
        const dueAt = dueAtForSourcingSla("quote_submission", now, slaConfig);
        await tx.sourcingSlaRecord.create({
          data: {
            workspaceId: item.workspaceId,
            caseId,
            rule: "quote_submission",
            ownerId: command.assigneeId,
            startedAt: now,
            dueAt,
          },
        });
        slaData = { slaDueAt: dueAt, slaRule: "quote_submission" };
      } else {
        await tx.sourcingSlaRecord.updateMany({
          where: { caseId, completedAt: null },
          data: { ownerId: command.assigneeId },
        });
      }
      const updated = await bump({
        assignedToId: command.assigneeId,
        stage: item.stage === "draft" ? "sourcing" : item.stage,
        ...slaData,
      });
      await event(tx, caseId, item.workspaceId, actor.id, "assigned", {
        assigneeId: command.assigneeId,
      });
      return updated;
    }
    if (
      ["create_quote", "save_quote", "submit_quote"].includes(command.action)
    ) {
      requireAssigned();
      const stageEditable = editableStages.includes(item.stage) || item.stage === "quoted";
      if (!stageEditable)
        throw new SourcingAccessError(
          "Quotes cannot be changed at this stage",
          409,
        );
      if (!command.quote)
        throw new SourcingAccessError("A valid quote is required", 400);
      const latest = await tx.sourcingQuote.findFirst({
        where: { caseId },
        orderBy: { revision: "desc" },
      });
      const quoteInput = command.quote;
      const landedCostSnapshot =
        command.action === "submit_quote"
          ? calculateSourcingLandedCost(
              {
                unitCostCny: quoteInput.unitPriceRmb,
                piecesPerSellingUnit: quoteInput.piecesPerSellingUnit,
                cartonLengthCm: quoteInput.cartonLengthCm,
                cartonWidthCm: quoteInput.cartonWidthCm,
                cartonHeightCm: quoteInput.cartonHeightCm,
                piecesPerCarton: quoteInput.piecesPerCarton,
                marketPriceMyr: quoteInput.marketPriceMyr,
                marketPack: quoteInput.marketPack,
                overrideCostMyr: quoteInput.overrideCostMyr,
              },
              costConfig,
            )
          : null;
      if (command.action === "submit_quote" && !landedCostSnapshot) {
        throw new SourcingAccessError(
          "A supplier cost or RM override is required before submitting a quote",
          400,
        );
      }
      const quoteData = {
        supplierName: quoteInput.supplierName.trim(),
        supplierId: quoteInput.supplierId || null,
        currency: "CNY",
        items: json([
          {
            name: item.title,
            sku: item.id,
            quantity: item.requestedQuantity ?? quoteInput.moq ?? 1,
            unitCost: quoteInput.unitPriceRmb,
          },
        ]),
        unitPriceRmb: quoteInput.unitPriceRmb,
        piecesPerSellingUnit: quoteInput.piecesPerSellingUnit ?? null,
        cartonLengthCm: quoteInput.cartonLengthCm ?? null,
        cartonWidthCm: quoteInput.cartonWidthCm ?? null,
        cartonHeightCm: quoteInput.cartonHeightCm ?? null,
        piecesPerCarton: quoteInput.piecesPerCarton ?? null,
        marketPriceMyr: quoteInput.marketPriceMyr ?? null,
        marketPack: quoteInput.marketPack ?? null,
        overrideCostMyr: quoteInput.overrideCostMyr ?? null,
        ...(command.action === "submit_quote"
          ? {
              costParamsSnapshot: json(costConfig),
              landedCostSnapshot: json(landedCostSnapshot),
            }
          : {}),
        moq: quoteInput.moq ?? null,
        unitsPerCarton: quoteInput.unitsPerCarton ?? null,
        cartonDimensions: quoteInput.cartonDimensions?.trim() || null,
        cartonWeightKg: quoteInput.cartonWeightKg ?? null,
        leadTimeDays: quoteInput.leadTimeDays ?? null,
        validUntil: quoteInput.validUntil
          ? new Date(quoteInput.validUntil)
          : null,
        samplePhotoUrls: json(quoteInput.samplePhotoUrls),
        paymentTerms: quoteInput.paymentTerms?.trim() || null,
        certifications: json(quoteInput.certifications),
        complianceNotes: quoteInput.complianceNotes?.trim() || null,
        riskLevel: quoteInput.riskLevel || null,
        recommendation: quoteInput.recommendation?.trim() || null,
        priceBreaks: json(quoteInput.priceBreaks),
        notes: quoteInput.remarks?.trim() || null,
      };
      // Revisions remain case-wide for the existing unique constraint; groups identify an offer.
      const revision = (latest?.revision ?? 0) + 1;
      // A draft is the editable working copy. Revisions are created only after submission or a change request.
      const target = command.quoteId
        ? await tx.sourcingQuote.findFirst({
            where: { id: command.quoteId, caseId, status: "draft" },
          })
        : null;
      if (command.quoteId && !target)
        throw new SourcingAccessError(
          "The selected quote is not an editable draft",
          409,
        );
      const quote =
        command.action !== "create_quote" && target
          ? await tx.sourcingQuote.update({
              where: { id: target.id },
              data: {
                ...quoteData,
                status:
                  command.action === "submit_quote" ? "submitted" : "draft",
                submittedAt:
                  command.action === "submit_quote" ? new Date() : null,
              },
            })
          : await tx.sourcingQuote.create({
              data: {
                workspaceId: item.workspaceId,
                caseId,
                quoteGroupId: new ObjectId().toHexString(),
                revision,
                status: command.action === "submit_quote" ? "submitted" : "draft",
                submittedAt:
                  command.action === "submit_quote" ? new Date() : null,
                ...quoteData,
                createdById: actor.id,
              },
            });
      const opensApprovalWindow =
        command.action === "submit_quote" &&
        !["quoted", "changes_requested"].includes(item.stage);
      const now = new Date();
      const updated = await bump({
        ...(opensApprovalWindow
          ? {
              stage: "quoted",
              slaDueAt: dueAtForSourcingSla("approval", now, slaConfig),
              slaRule: "approval",
            }
          : {
              stage:
                command.action === "submit_quote" &&
                item.stage === "changes_requested"
                  ? "quoted"
                  : item.stage,
            }),
      });
      if (command.action === "submit_quote") {
        if (opensApprovalWindow) {
          await completeSourcingSla(tx, caseId, "quote_submission", now);
          await tx.sourcingSlaRecord.create({
            data: {
              workspaceId: item.workspaceId,
              caseId,
              rule: "approval",
              startedAt: now,
              dueAt: dueAtForSourcingSla("approval", now, slaConfig),
            },
          });
        }
      }
      await event(tx, caseId, item.workspaceId, actor.id, command.action, {
        quoteId: quote.id,
        revision: quote.revision,
      });
      return updated;
    }
    if (command.action === "submit_all_drafts") {
      requireAssigned();
      const stageEditable = editableStages.includes(item.stage) || item.stage === "quoted";
      if (!stageEditable)
        throw new SourcingAccessError(
          "Quotes cannot be changed at this stage",
          409,
        );
      const drafts = await tx.sourcingQuote.findMany({
        where: { caseId, status: "draft" },
      });
      if (drafts.length === 0)
        throw new SourcingAccessError("No draft quotes to submit", 400);
      const now = new Date();
      for (const draft of drafts) {
        if (!draft.unitPriceRmb && !draft.overrideCostMyr)
          throw new SourcingAccessError(
            `Quote "${draft.supplierName}" requires a supplier cost or RM override before submission`,
            400,
          );
        const landedCostSnapshot = calculateSourcingLandedCost(
          {
            unitCostCny: draft.unitPriceRmb,
            piecesPerSellingUnit: draft.piecesPerSellingUnit,
            cartonLengthCm: draft.cartonLengthCm,
            cartonWidthCm: draft.cartonWidthCm,
            cartonHeightCm: draft.cartonHeightCm,
            piecesPerCarton: draft.piecesPerCarton,
            marketPriceMyr: draft.marketPriceMyr,
            marketPack: draft.marketPack,
            overrideCostMyr: draft.overrideCostMyr,
          },
          costConfig,
        );
        if (!landedCostSnapshot)
          throw new SourcingAccessError(
            `Quote "${draft.supplierName}" requires a supplier cost or RM override before submission`,
            400,
          );
        await tx.sourcingQuote.update({
          where: { id: draft.id },
          data: {
            status: "submitted",
            submittedAt: now,
            costParamsSnapshot: json(costConfig),
            landedCostSnapshot: json(landedCostSnapshot),
          },
        });
      }
      const opensApprovalWindow = !["quoted", "changes_requested"].includes(
        item.stage,
      );
      const updated = await bump(
        opensApprovalWindow
          ? {
              stage: "quoted",
              slaDueAt: dueAtForSourcingSla("approval", now, slaConfig),
              slaRule: "approval",
            }
          : { stage: item.stage === "changes_requested" ? "quoted" : item.stage },
      );
      if (opensApprovalWindow) {
        await completeSourcingSla(tx, caseId, "quote_submission", now);
        await tx.sourcingSlaRecord.create({
          data: {
            workspaceId: item.workspaceId,
            caseId,
            rule: "approval",
            startedAt: now,
            dueAt: dueAtForSourcingSla("approval", now, slaConfig),
          },
        });
      }
      await event(tx, caseId, item.workspaceId, actor.id, "submit_all_drafts", {
        quoteIds: drafts.map((d) => d.id),
        count: drafts.length,
      });
      return updated;
    }
    if (command.action === "delete_quote") {
      requireAssigned();
      const stageEditable = editableStages.includes(item.stage) || item.stage === "quoted";
      if (!stageEditable)
        throw new SourcingAccessError(
          "Quotes cannot be changed at this stage",
          409,
        );
      if (!command.quoteId)
        throw new SourcingAccessError("A quote must be selected", 400);
      const target = await tx.sourcingQuote.findFirst({
        where: { id: command.quoteId, caseId, status: "draft" },
      });
      if (!target)
        throw new SourcingAccessError(
          "Only draft quotes can be deleted",
          409,
        );
      await tx.sourcingQuote.delete({ where: { id: target.id } });
      await event(tx, caseId, item.workspaceId, actor.id, "delete_quote", {
        quoteId: target.id,
        supplierName: target.supplierName,
      });
      const updated = await bump({ version: { increment: 1 } });
      return updated;
    }
    if (command.action === "withdraw_quote") {
      requireAssigned();
      if (item.stage !== "quoted")
        throw new SourcingAccessError(
          "Offers can only be withdrawn while awaiting a decision",
          409,
        );
      if (!command.quoteId)
        throw new SourcingAccessError("An offer must be selected", 400);
      const target = await tx.sourcingQuote.findFirst({
        where: { id: command.quoteId, caseId, status: "submitted" },
      });
      if (!target)
        throw new SourcingAccessError(
          "Only unapproved submitted offers can be withdrawn",
          409,
        );
      await tx.sourcingQuote.update({
        where: { id: target.id },
        data: { status: "withdrawn" },
      });
      const remainingOffers = await tx.sourcingQuote.count({
        where: { caseId, status: "submitted" },
      });
      const now = new Date();
      let workflowData: Prisma.SourcingCaseUpdateInput = {};
      if (remainingOffers === 0) {
        const quoteDueAt = dueAtForSourcingSla("quote_submission", now, slaConfig);
        // End the inactive approval window without treating it as an approval decision.
        await tx.sourcingSlaRecord.updateMany({
          where: { caseId, rule: "approval", completedAt: null },
          data: { completedAt: now, onTime: null },
        });
        await tx.sourcingSlaRecord.create({
          data: {
            workspaceId: item.workspaceId,
            caseId,
            rule: "quote_submission",
            ownerId: item.assignedToId,
            startedAt: now,
            dueAt: quoteDueAt,
          },
        });
        workflowData = {
          stage: "sourcing",
          slaDueAt: quoteDueAt,
          slaRule: "quote_submission",
        };
      }
      const updated = await bump(workflowData);
      await event(tx, caseId, item.workspaceId, actor.id, "offer_withdrawn", {
        quoteId: target.id,
        supplierName: target.supplierName,
        remainingOffers,
      });
      return updated;
    }
    if (
      [
        "request_changes",
        "approve",
        "approve_and_create_order",
        "reject",
        "cannot_source",
        "cancel",
        "archive",
        "revive",
        "repeat",
      ].includes(command.action)
    ) {
      if (
        !["archive", "revive", "repeat"].includes(command.action) &&
        access.role !== "admin" &&
        !access.globalAdmin
      )
        throw new SourcingAccessError(
          "Only workspace admins can make a sourcing decision",
        );
      const latestSubmitted = command.quoteId
        ? await tx.sourcingQuote.findFirst({
            where: { id: command.quoteId, caseId, status: "submitted" },
          })
        : null;
      const latest = await tx.sourcingQuote.findFirst({
        where: { caseId },
        orderBy: { revision: "desc" },
      });
      if (
        ["request_changes", "approve", "approve_and_create_order", "reject", "cannot_source"].includes(
          command.action,
        ) &&
        !latestSubmitted &&
        command.action !== "cannot_source"
      )
        throw new SourcingAccessError("A submitted quote is required", 409);
      if (command.action === "request_changes") {
        if (item.stage !== "quoted")
          throw new SourcingAccessError(
            "Only quoted cases can request changes",
            409,
          );
        if (!command.reason?.trim())
          throw new SourcingAccessError(
            "Change request reason is required",
            400,
          );
        const copied = await tx.sourcingQuote.create({
          data: {
            workspaceId: item.workspaceId,
            caseId,
            quoteGroupId: quoteGroupKey(latestSubmitted!),
            revision: (latest?.revision ?? 0) + 1,
            status: "draft",
            supplierName: latestSubmitted!.supplierName,
            supplierId: latestSubmitted!.supplierId,
            currency: latestSubmitted!.currency,
            items: json(latestSubmitted!.items),
            unitPriceRmb: latestSubmitted!.unitPriceRmb,
            piecesPerSellingUnit: latestSubmitted!.piecesPerSellingUnit,
            cartonLengthCm: latestSubmitted!.cartonLengthCm,
            cartonWidthCm: latestSubmitted!.cartonWidthCm,
            cartonHeightCm: latestSubmitted!.cartonHeightCm,
            piecesPerCarton: latestSubmitted!.piecesPerCarton,
            marketPriceMyr: latestSubmitted!.marketPriceMyr,
            marketPack: latestSubmitted!.marketPack,
            overrideCostMyr: latestSubmitted!.overrideCostMyr,
            costParamsSnapshot:
              latestSubmitted!.costParamsSnapshot ?? undefined,
            landedCostSnapshot:
              latestSubmitted!.landedCostSnapshot ?? undefined,
            moq: latestSubmitted!.moq,
            unitsPerCarton: latestSubmitted!.unitsPerCarton,
            cartonDimensions: latestSubmitted!.cartonDimensions,
            cartonWeightKg: latestSubmitted!.cartonWeightKg,
            leadTimeDays: latestSubmitted!.leadTimeDays,
            validUntil: latestSubmitted!.validUntil,
            samplePhotoUrls: latestSubmitted!.samplePhotoUrls ?? undefined,
            paymentTerms: latestSubmitted!.paymentTerms,
            certifications: latestSubmitted!.certifications ?? undefined,
            complianceNotes: latestSubmitted!.complianceNotes,
            riskLevel: latestSubmitted!.riskLevel,
            recommendation: latestSubmitted!.recommendation,
            priceBreaks: latestSubmitted!.priceBreaks ?? undefined,
            notes: latestSubmitted!.notes,
            createdById: actor.id,
          },
        });
        await tx.sourcingQuote.update({
          where: { id: latestSubmitted!.id },
          data: {
            status: "superseded",
            quoteGroupId: quoteGroupKey(latestSubmitted!),
          },
        });
        const updated = await bump({ stage: "changes_requested" });
        await event(
          tx,
          caseId,
          item.workspaceId,
          actor.id,
          "changes_requested",
          {
            quoteId: copied.id,
            sourceQuoteId: latestSubmitted!.id,
            quoteGroupId: quoteGroupKey(latestSubmitted!),
            supplierName: latestSubmitted!.supplierName,
            reason: command.reason.trim(),
          },
        );
        return updated;
      }
      if (
        command.action === "approve" ||
        command.action === "approve_and_create_order" ||
        command.action === "reject" ||
        command.action === "cannot_source"
      ) {
        if (!["quoted", "changes_requested", "sourcing"].includes(item.stage))
          throw new SourcingAccessError(
            "This case is not awaiting a decision",
            409,
          );
        if (
          ["reject", "cannot_source"].includes(command.action) &&
          !command.reason?.trim()
        )
          throw new SourcingAccessError("A reason is required", 400);
        let approvalData: Prisma.SourcingCaseUpdateInput = {};
        let approvedQuote: SourcingQuote | null = null;
        if (
          command.action === "approve" ||
          command.action === "approve_and_create_order"
        ) {
          const selected = latestSubmitted!;
          const referenceRate = approvalReferenceRate;
          const rate = command.fxRateOverride ?? referenceRate?.rate;
          if (
            !rate ||
            (!command.fxRateOverride && !referenceRate) ||
            (!command.fxRateOverride && !isExchangeRateFresh(referenceRate!))
          ) {
            throw new SourcingAccessError(
              "A current CNY to MYR exchange rate is required before approval",
              409,
            );
          }
          const unitPriceMyr =
            selected.unitPriceRmb == null
              ? null
              : convertMoney(selected.unitPriceRmb, rate);
          approvedQuote = await tx.sourcingQuote.update({
            where: { id: selected.id },
            data: {
              unitPriceMyr,
              fxRate: rate,
              fxRateDate: referenceRate?.rateDate ?? new Date(),
              fxProvider: command.fxRateOverride
                ? "admin_override"
                : referenceRate!.provider,
              fxOverriddenById: command.fxRateOverride ? actor.id : null,
              fxOverrideReason: command.fxRateOverride
                ? command.fxOverrideReason!.trim()
                : null,
              approvedAt: new Date(),
            },
          });
          approvalData = { selectedQuoteId: selected.id };
        }
        const now = new Date();
        if (["approve", "approve_and_create_order", "reject"].includes(command.action))
          await completeSourcingSla(tx, caseId, "approval", now);
        if (command.action === "approve_and_create_order") {
          const { purchaseOrderId, shipmentDueAt } =
            await createOrderFromApprovedQuote(
              tx,
              actor,
              item,
              caseId,
              approvedQuote!,
              slaConfig,
              command.orderQuantity,
            );
          await tx.sourcingQuote.updateMany({
            where: {
              caseId,
              status: "submitted",
              id: { not: approvedQuote!.id },
            },
            data: { status: "not_selected" },
          });
          await tx.sourcingQuote.updateMany({
            where: { caseId, status: "draft" },
            data: { status: "discarded" },
          });
          const updated = await bump({
            stage: "ordered",
            slaDueAt: shipmentDueAt,
            slaRule: "shipment",
            ...approvalData,
          });
          await event(tx, caseId, item.workspaceId, actor.id, "approve", {
            quoteId: latestSubmitted!.id,
            fxRateOverride: command.fxRateOverride,
          });
          await event(tx, caseId, item.workspaceId, actor.id, "order_confirmed", {
            purchaseOrderId,
            quoteId: latestSubmitted!.id,
          });
          return updated;
        }
        const stage =
          command.action === "approve" ? "approved" : command.action;
        const updated = await bump({
          stage,
          slaDueAt: null,
          slaRule: null,
          ...approvalData,
        });
        await event(tx, caseId, item.workspaceId, actor.id, command.action, {
          reason: command.reason,
          quoteId:
            command.action === "approve" ? latestSubmitted?.id : undefined,
          fxRateOverride: command.fxRateOverride,
        });
        return updated;
      }
      if (command.action === "cancel") {
        if (["cancelled", "archived", "ordered", "shipping", "received", "rejected", "cannot_source"].includes(item.stage))
          throw new SourcingAccessError(
            "This case cannot be cancelled at its current stage",
            409,
          );
        const now = new Date();
        await tx.sourcingSlaRecord.updateMany({
          where: { caseId, completedAt: null },
          data: { completedAt: now },
        });
        const updated = await bump({
          stage: "cancelled",
          slaDueAt: null,
          slaRule: null,
          nextAction: null,
          nextActionAt: null,
        });
        await event(tx, caseId, item.workspaceId, actor.id, "cancel", {
          reason: command.reason,
        });
        return updated;
      }
      if (command.action === "archive" || command.action === "revive") {
        if (access.role !== "admin" && !access.globalAdmin)
          throw new SourcingAccessError(
            "Only workspace admins can archive cases",
          );
        if (
          command.action === "archive" &&
          ["ordered", "shipping", "received"].includes(item.stage)
        )
          throw new SourcingAccessError(
            "Ordered, shipping, or received cases cannot be archived",
            409,
          );
        const updated = await bump(
          command.action === "archive"
            ? { stage: "archived", archivedAt: new Date() }
            : { stage: "draft", archivedAt: null },
        );
        await event(tx, caseId, item.workspaceId, actor.id, command.action);
        return updated;
      }
      if (access.role !== "admin" && !access.globalAdmin)
        throw new SourcingAccessError("Only workspace admins can repeat cases");
      if (item.stage !== "archived" || !item.archivedAt)
        throw new SourcingAccessError(
          "Only archived cases can be repeated",
          409,
        );
      const duplicate = await tx.sourcingCase.create({
        data: {
          workspaceId: item.workspaceId,
          title: `${item.title} (repeat)`,
          description: item.description,
          photoUrls: item.photoUrls ?? undefined,
          size: item.size,
          material: item.material,
          variant: item.variant,
          specifications: item.specifications,
          referenceUrl: item.referenceUrl,
          notes: item.notes,
          requestedQuantity: item.requestedQuantity,
          targetUnitPriceMyr: item.targetUnitPriceMyr,
          stage: "draft",
          createdById: actor.id,
        },
      });
      await event(tx, duplicate.id, item.workspaceId, actor.id, "repeated", {
        sourceCaseId: caseId,
      });
      return duplicate;
    }
    if (command.action === "confirm_order") {
      if (access.role !== "admin" && !access.globalAdmin)
        throw new SourcingAccessError(
          "Only workspace admins can confirm orders",
        );
      if (item.stage !== "approved")
        throw new SourcingAccessError(
          "Only approved cases can be ordered",
          409,
        );
      const quote = item.selectedQuoteId
        ? await tx.sourcingQuote.findFirst({
            where: { id: item.selectedQuoteId, caseId, status: "submitted" },
          })
        : null;
      if (!quote) throw new SourcingAccessError("No approved quote found", 409);
      const { purchaseOrderId, shipmentDueAt } = await createOrderFromApprovedQuote(
        tx,
        actor,
        item,
        caseId,
        quote,
        slaConfig,
      );
      const updated = await bump({
        stage: "ordered",
        slaDueAt: shipmentDueAt,
        slaRule: "shipment",
      });
      await event(tx, caseId, item.workspaceId, actor.id, "order_confirmed", {
        purchaseOrderId,
      });
      return updated;
    }
    throw new SourcingAccessError("Unknown sourcing command", 400);
  });
  const notification = async () => {
    if (command.action === "assign" && command.assigneeId) {
      await deliverSourcingNotification({
        workspaceId: current.workspaceId,
        caseId,
        recipientIds: [command.assigneeId],
        excludeUserId: actor.id,
        kind: "assignment",
        title: "Sourcing case assigned",
        message: `${actor.name} assigned you to ${current.title}.`,
        dedupeKey: `assigned:${caseId}:${result.version}:${command.assigneeId}`,
      });
      return;
    }
    if (command.action === "submit_quote") {
      await deliverSourcingNotification({
        workspaceId: current.workspaceId,
        caseId,
        recipientIds: await sourcingAdmins(current.workspaceId),
        excludeUserId: actor.id,
        kind: "quote",
        title: "Sourcing quote submitted",
        message: `${actor.name} submitted a quote for ${current.title}.`,
        dedupeKey: `submit_quote:${caseId}:${result.version}`,
      });
      return;
    }
    if (command.action === "withdraw_quote") {
      await deliverSourcingNotification({
        workspaceId: current.workspaceId,
        caseId,
        recipientIds: await sourcingAdmins(current.workspaceId),
        excludeUserId: actor.id,
        kind: "quote",
        title: "Supplier offer withdrawn",
        message: `${actor.name} withdrew a supplier offer for ${current.title}.`,
        dedupeKey: `withdraw_quote:${caseId}:${result.version}`,
      });
      return;
    }
    if (
      ["confirm_order", "approve_and_create_order"].includes(command.action) &&
      current.assignedToId
    ) {
      await deliverSourcingNotification({
        workspaceId: current.workspaceId,
        caseId,
        recipientIds: [current.assignedToId],
        excludeUserId: actor.id,
        kind: "decision",
        title: "Order placed - arrange shipment",
        message: `${actor.name} confirmed the order for ${current.title}. Arrange shipment and add tracking.`,
        dedupeKey: `${command.action}:${caseId}:${result.version}`,
      });
      return;
    }
    if (
      ["request_changes", "approve", "reject", "cannot_source"].includes(
        command.action,
      ) &&
      current.assignedToId
    ) {
      const messages: Record<string, string> = {
        request_changes: `${actor.name} requested changes to a supplier offer for ${current.title}: ${command.reason}.`,
        approve: `${actor.name} approved the quote for ${current.title}.`,
        reject: `${actor.name} rejected the quote for ${current.title}.`,
        cannot_source: `${actor.name} marked ${current.title} as cannot source.`,
      };
      await deliverSourcingNotification({
        workspaceId: current.workspaceId,
        caseId,
        recipientIds: [current.assignedToId],
        excludeUserId: actor.id,
        kind: "decision",
        title: "Sourcing quote decision",
        message: messages[command.action]!,
        dedupeKey: `${command.action}:${caseId}:${result.version}`,
      });
    }
  };
  void notification().catch((error) =>
    logger.error("[Sourcing] Command notification delivery failed", error),
  );
  return result;
}
