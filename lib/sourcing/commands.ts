import { Prisma } from "@prisma/client";
import { prisma } from "@/prisma/client";
import { createNotification } from "@/prisma/notification";
import { logger } from "@/lib/logger";
import { isBrevoConfigured, sendEmailViaBrevo } from "@/lib/email/brevo";
import { requireWorkspaceRole, SourcingAccessError } from "./auth";
import type {
  SourcingCaseInput,
  SourcingQuoteInput,
} from "@/lib/validations/sourcing";
import { nextQuoteRevision } from "./workflow";

type Actor = { id: string; role: string | null; email: string; name: string };
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
    | "save_quote"
    | "submit_quote"
    | "request_changes"
    | "approve"
    | "reject"
    | "cannot_source"
    | "confirm_order"
    | "archive"
    | "revive"
    | "repeat";
  version: number;
  assigneeId?: string;
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
};

async function notify(
  workspaceId: string,
  excludeUserId: string,
  title: string,
  message: string,
  link: string,
) {
  try {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, role: { in: ["admin", "sourcer"] } },
      select: { userId: true },
    });
    const recipients = members.filter(
      (member) => member.userId !== excludeUserId,
    );
    await Promise.all(
      recipients.map((member) =>
        createNotification({
          userId: member.userId,
          type: "system_alert",
          title,
          message,
          link,
          metadata: { workspaceId },
        }),
      ),
    );
    if (isBrevoConfigured() && recipients.length) {
      const users = await prisma.user.findMany({
        where: { id: { in: recipients.map((member) => member.userId) } },
        select: { email: true, name: true },
      });
      await Promise.all(
        users.map((recipient) =>
          sendEmailViaBrevo({
            to: { email: recipient.email, name: recipient.name },
            subject: title,
            htmlContent: `<p>${message}</p><p><a href="${link}">Open sourcing case</a></p>`,
            textContent: `${message}\n${link}`,
            tags: ["sourcing", "transactional"],
          }),
        ),
      );
    }
  } catch (error) {
    // Notifications are post-commit convenience, never a reason to roll back procurement.
    logger.error("[Sourcing] Notification delivery failed", error);
  }
}

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
  if (input.assignedToId) {
    if (!access.globalAdmin && access.role !== "admin")
      throw new SourcingAccessError("Only workspace admins can assign cases");
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: input.workspaceId,
          userId: input.assignedToId,
        },
      },
    });
    if (!member || !["admin", "sourcer"].includes(member.role))
      throw new SourcingAccessError(
        "Assignee must be a sourcing workspace member",
        400,
      );
  }
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
        route: input.route,
        assignedToId: input.assignedToId || null,
        createdById: actor.id,
        stage: input.assignedToId ? "sourcing" : "draft",
      },
      include: listInclude,
    });
    await event(tx, created.id, input.workspaceId, actor.id, "case_created", {
      assignedToId: input.assignedToId,
    });
    return created;
  });
  void notify(
    input.workspaceId,
    actor.id,
    "New sourcing case",
    sourcingCase.title,
    `/sourcing/${sourcingCase.id}`,
  );
  return sourcingCase;
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
  const access = await requireWorkspaceRole(actor, current.workspaceId, [
    "admin",
    "sourcer",
  ]);
  const isAssigned = current.assignedToId === actor.id;
  const requireAssigned = () => {
    if (!access.globalAdmin && access.role !== "admin" && !isAssigned)
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
      const member = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: item.workspaceId,
            userId: command.assigneeId,
          },
        },
      });
      if (!member || !["admin", "sourcer"].includes(member.role))
        throw new SourcingAccessError(
          "Assignee must be a sourcing member",
          400,
        );
      const updated = await bump({
        assignedToId: command.assigneeId,
        stage: item.stage === "draft" ? "sourcing" : item.stage,
      });
      await event(tx, caseId, item.workspaceId, actor.id, "assigned", {
        assigneeId: command.assigneeId,
      });
      return updated;
    }
    if (["save_quote", "submit_quote"].includes(command.action)) {
      requireAssigned();
      if (!editableStages.includes(item.stage))
        throw new SourcingAccessError(
          "Quotes cannot be changed at this stage",
          409,
        );
      const latest = await tx.sourcingQuote.findFirst({
        where: { caseId },
        orderBy: { revision: "desc" },
      });
      if (!command.quote)
        throw new SourcingAccessError("A valid quote is required", 400);
      const quoteInput = command.quote;
      const quoteData = {
        supplierName: quoteInput.supplierName.trim(),
        supplierId: quoteInput.supplierId || null,
        currency: "CNY",
        items: json([
          {
            name: item.title,
            sku: item.id,
            quantity: quoteInput.moq ?? 1,
            unitCost: quoteInput.unitPriceRmb,
          },
        ]),
        unitPriceRmb: quoteInput.unitPriceRmb,
        moq: quoteInput.moq ?? null,
        unitsPerCarton: quoteInput.unitsPerCarton ?? null,
        cartonDimensions: quoteInput.cartonDimensions?.trim() || null,
        cartonWeightKg: quoteInput.cartonWeightKg ?? null,
        leadTimeDays: quoteInput.leadTimeDays ?? null,
        validUntil: quoteInput.validUntil
          ? new Date(quoteInput.validUntil)
          : null,
        samplePhotoUrls: json(quoteInput.samplePhotoUrls),
        notes: quoteInput.remarks?.trim() || null,
      };
      const revision = nextQuoteRevision(latest);
      // A draft is the editable working copy. Revisions are created only after submission or a change request.
      const quote =
        latest?.status === "draft"
          ? await tx.sourcingQuote.update({
              where: { id: latest.id },
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
                revision,
                status:
                  command.action === "submit_quote" ? "submitted" : "draft",
                ...quoteData,
                submittedAt:
                  command.action === "submit_quote" ? new Date() : undefined,
                createdById: actor.id,
              },
            });
      const updated = await bump({
        stage: command.action === "submit_quote" ? "quoted" : item.stage,
      });
      await event(tx, caseId, item.workspaceId, actor.id, command.action, {
        quoteId: quote.id,
        revision,
      });
      return updated;
    }
    if (
      [
        "request_changes",
        "approve",
        "reject",
        "cannot_source",
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
      const submitted = await tx.sourcingQuote.findFirst({
        where: { caseId, status: "submitted" },
        orderBy: { revision: "desc" },
      });
      if (
        ["request_changes", "approve", "reject", "cannot_source"].includes(
          command.action,
        ) &&
        !submitted &&
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
            revision: (submitted?.revision ?? 0) + 1,
            status: "draft",
            supplierName: submitted!.supplierName,
            supplierId: submitted!.supplierId,
            currency: submitted!.currency,
            items: json(submitted!.items),
            unitPriceRmb: submitted!.unitPriceRmb,
            moq: submitted!.moq,
            unitsPerCarton: submitted!.unitsPerCarton,
            cartonDimensions: submitted!.cartonDimensions,
            cartonWeightKg: submitted!.cartonWeightKg,
            leadTimeDays: submitted!.leadTimeDays,
            validUntil: submitted!.validUntil,
            samplePhotoUrls: submitted!.samplePhotoUrls ?? undefined,
            notes: command.reason.trim(),
            createdById: actor.id,
          },
        });
        await tx.sourcingQuote.update({
          where: { id: submitted!.id },
          data: { status: "superseded" },
        });
        const updated = await bump({ stage: "changes_requested" });
        await event(
          tx,
          caseId,
          item.workspaceId,
          actor.id,
          "changes_requested",
          { quoteId: copied.id, reason: command.reason },
        );
        return updated;
      }
      if (
        command.action === "approve" ||
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
        const stage =
          command.action === "approve" ? "approved" : command.action;
        const updated = await bump({ stage });
        await event(tx, caseId, item.workspaceId, actor.id, command.action, {
          reason: command.reason,
        });
        return updated;
      }
      if (command.action === "archive" || command.action === "revive") {
        if (access.role !== "admin" && !access.globalAdmin)
          throw new SourcingAccessError(
            "Only workspace admins can archive cases",
          );
        if (command.action === "archive" && item.stage === "ordered")
          throw new SourcingAccessError(
            "Ordered cases cannot be archived",
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
          route: item.route,
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
      const quote = await tx.sourcingQuote.findFirst({
        where: { caseId, status: "submitted" },
        orderBy: { revision: "desc" },
      });
      if (!quote) throw new SourcingAccessError("No approved quote found", 409);
      const lines = quote.items as unknown as QuoteItem[];
      const supplier = quote.supplierId
        ? await tx.supplier.findFirst({
            where: { id: quote.supplierId, workspaceId: item.workspaceId },
          })
        : await tx.supplier.findFirst({
            where: { name: quote.supplierName, workspaceId: item.workspaceId },
          });
      if (!supplier)
        throw new SourcingAccessError(
          "Quote supplier must be a workspace supplier before ordering",
          400,
        );
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
          const category = line.categoryId
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
          if (!category)
            throw new SourcingAccessError(
              "Create an active workspace category before ordering a new sourced product",
              400,
            );
          product = await tx.product.create({
            data: {
              name: line.name,
              sku: line.sku,
              skuScopeId: item.workspaceId,
              price: line.unitCost,
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
          quantity: line.quantity,
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
          createdById: actor.id,
        },
      });
      const updated = await bump({ stage: "ordered" });
      await event(tx, caseId, item.workspaceId, actor.id, "order_confirmed", {
        purchaseOrderId: po.id,
      });
      return updated;
    }
    throw new SourcingAccessError("Unknown sourcing command", 400);
  });
  void notify(
    current.workspaceId,
    actor.id,
    "Sourcing case updated",
    `${current.title}: ${command.action}`,
    `/sourcing/${caseId}`,
  );
  return result;
}
