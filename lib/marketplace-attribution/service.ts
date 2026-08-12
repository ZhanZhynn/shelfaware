import prisma from "@/prisma/client";
import type { Prisma } from "@prisma/client";
import { intervalsOverlap } from "./intervals";
import { resolveShopeeProductId } from "./shopee-identity";
import { createHash } from "crypto";
import {
  csvIntraFileConflicts,
  parseMappingCsv,
  type MappingCsvRow,
} from "./csv";
import { normalizeShopeeExternalId } from "./shopee-external-id";

export type ConfirmMappingInput = {
  platform: "shopee";
  shopId: string;
  externalProductId: string;
  externalVariantId?: string;
  offerKind: "variant" | "verified-product";
  salesSkuId: string;
  effectiveFrom?: Date;
  candidateId?: string;
};

const nonvariantLineWhere = () => ({
  // Legacy sync persisted Shopee's documented nonvariant sentinel as 0.
  OR: [{ shopeeModelId: null }, { shopeeModelId: 0 }],
});

async function nonvariantLinesForOffer(
  input: Omit<ConfirmMappingInput, "salesSkuId" | "effectiveFrom">,
  from?: Date,
) {
  const order = {
    shopId: input.shopId,
    orderStatus: { notIn: ["CANCELLED", "UNPAID"] },
    shopeeCreatedAt: from ? { gte: from } : { not: null },
  };
  const [products, lines] = await Promise.all([
    prisma.shopeeProduct.findMany({
      where: { shopId: input.shopId, variants: { none: {} } },
      select: { shopeeItemId: true, itemSku: true },
    }),
    prisma.shopeeOrderItem.findMany({
      where: { ...nonvariantLineWhere(), order },
      orderBy: { order: { shopeeCreatedAt: "asc" } },
      select: {
        quantity: true,
        subtotal: true,
        shopeeItemId: true,
        sku: true,
        productName: true,
        order: { select: { currency: true, shopeeCreatedAt: true } },
      },
    }),
  ]);
  const targetId = Number(input.externalProductId);
  const targetProduct = products.find(
    (product) => product.shopeeItemId === targetId,
  );
  const resolved = lines.filter(
    (line) => resolveShopeeProductId(line, products) === targetId,
  );
  // A legacy line without an item ID can belong to this offer only through its
  // durable SKU fallback. Do not surface unrelated unresolved shop lines here.
  const unverifiableLegacyLines =
    targetProduct?.itemSku == null
      ? 0
      : lines.filter(
          (line) =>
            line.shopeeItemId == null &&
            line.sku === targetProduct.itemSku &&
            resolveShopeeProductId(line, products) == null,
        ).length;
  return { lines: resolved, unverifiableLegacyLines };
}

function isTransactionConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string | number }).code === "P2034" ||
      (error as { code?: string | number }).code === 112 ||
      (error as { code?: string | number }).code === "P2002")
  );
}

export async function withOfferLocks<T>(
  offers: { platform: string; shopId: string; offerKey: string }[],
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const uniqueOffers = [...new Map(
          offers.map((offer) => [`${offer.platform}:${offer.shopId}:${offer.offerKey}`, offer]),
        ).values()];
        for (const offer of uniqueOffers.sort((left, right) =>
          `${left.platform}:${left.shopId}:${left.offerKey}`.localeCompare(
            `${right.platform}:${right.shopId}:${right.offerKey}`,
          ),
        )) {
          // This write makes overlapping transactions for one offer conflict.
          await tx.marketplaceSkuMappingOfferLock.upsert({
            where: {
              platform_shopId_offerKey: {
                platform: offer.platform,
                shopId: offer.shopId,
                offerKey: offer.offerKey,
              },
            },
            create: {
              platform: offer.platform,
              shopId: offer.shopId,
              offerKey: offer.offerKey,
              version: 1,
            },
            update: { version: { increment: 1 }, updatedAt: new Date() },
          });
        }
        return operation(tx);
      });
    } catch (error) {
      if (attempt === 2 || !isTransactionConflict(error)) {
        if (isTransactionConflict(error))
          throw new Error(
            "This offer is being updated by another confirmation. Please retry.",
          );
        throw error;
      }
    }
  }
  throw new Error(
    "This offer is being updated by another confirmation. Please retry.",
  );
}

async function withOfferLock<T>(
  input: { platform: string; shopId: string },
  offerKey: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return withOfferLocks(
    [{ platform: input.platform, shopId: input.shopId, offerKey }],
    operation,
  );
}

type ShopeeOfferClient = Pick<
  Prisma.TransactionClient,
  "shopeeProduct" | "shopeeProductVariant"
>;

export function canonicalShopeeOffer(
  input: Pick<
    ConfirmMappingInput,
    "externalProductId" | "externalVariantId" | "offerKind"
  >,
) {
  const externalProductId = normalizeShopeeExternalId(input.externalProductId);
  if (input.offerKind === "verified-product")
    return {
      externalProductId,
      externalVariantId: undefined,
      offerKey: `shopee:${externalProductId}:product`,
    };
  const externalVariantId = input.externalVariantId
    ? normalizeShopeeExternalId(input.externalVariantId)
    : undefined;
  if (!externalVariantId)
    throw new Error(
      "A variant mapping needs its stable external variant identity.",
    );
  return {
    externalProductId,
    externalVariantId,
    offerKey: `shopee:${externalProductId}:${externalVariantId}`,
  };
}

export async function resolveShopeeOffer(
  input: Omit<ConfirmMappingInput, "salesSkuId" | "effectiveFrom">,
  client: ShopeeOfferClient = prisma,
) {
  const canonical = canonicalShopeeOffer(input);
  if (input.offerKind === "variant") {
    const variant = await client.shopeeProductVariant.findFirst({
      where: {
        shopId: input.shopId,
        shopeeItemId: Number(canonical.externalProductId),
        modelId: Number(canonical.externalVariantId),
      },
      select: { id: true },
    });
    if (!variant)
      throw new Error("The Shopee variant does not belong to this shop.");
  } else {
    const product = await client.shopeeProduct.findFirst({
      where: {
        shopId: input.shopId,
        shopeeItemId: Number(canonical.externalProductId),
        variants: { none: {} },
      },
      select: { id: true },
    });
    if (!product)
      throw new Error(
        "Product-level mapping is allowed only for a verified non-variant Shopee product.",
      );
  }
  return canonical.offerKey;
}

export async function confirmMapping(
  input: ConfirmMappingInput,
  actorId: string,
) {
  const canonical = canonicalShopeeOffer(input);
  input = {
    ...input,
    externalProductId: canonical.externalProductId,
    externalVariantId: canonical.externalVariantId,
  };
  const offerKey = await resolveShopeeOffer(input);
  const effectiveFrom =
    input.effectiveFrom ?? (await earliestEligibleSale(input));
  if (!effectiveFrom)
    throw new Error(
      "No eligible Shopee sale was found for this offer. Choose an effective date explicitly.",
    );
  return withOfferLock(input, offerKey, async (tx) => {
    const salesSku = await tx.salesSku.findUnique({
      where: { id: input.salesSkuId },
      select: { id: true, active: true },
    });
    if (!salesSku || !salesSku.active)
      throw new Error("The selected active Sales SKU does not exist.");
    const existing = await tx.marketplaceSkuMapping.findMany({
      where: { platform: input.platform, shopId: input.shopId, offerKey },
    });
    const candidate = { effectiveFrom, effectiveTo: null };
    if (existing.some((mapping) => intervalsOverlap(mapping, candidate)))
      throw new Error(
        "This offer already has a confirmed mapping overlapping the requested date. Use correction to split the active interval, or select a non-overlapping historical range.",
      );
    if (input.candidateId) {
      const accepted = await tx.marketplaceSkuCandidate.updateMany({
        where: {
          id: input.candidateId,
          platform: input.platform,
          shopId: input.shopId,
          offerKey,
          proposedSalesSkuId: input.salesSkuId,
          status: "open",
        },
        data: {
          status: "accepted",
          reviewedAt: new Date(),
          reviewedById: actorId,
        },
      });
      if (accepted.count !== 1)
        throw new Error(
          "This candidate is stale, rejected, or does not match the selected offer and Sales SKU.",
        );
    }
    const { candidateId: _candidateId, ...mappingInput } = input;
    const mapping = await tx.marketplaceSkuMapping.create({
      data: {
        ...mappingInput,
        effectiveFrom,
        offerKey,
        externalVariantId: input.externalVariantId ?? null,
        effectiveTo: null,
        createdById: actorId,
      },
    });
    await tx.marketplaceSkuMappingEvent.create({
      data: {
        mappingId: mapping.id,
        eventType: "confirmed",
        actorId,
        detail: { effectiveFrom: effectiveFrom.toISOString() },
      },
    });
    return mapping;
  });
}

type CsvValidation = {
  valid: boolean;
  errors: string[];
  offerKey: string | null;
  salesSkuId: string | null;
};
const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type CsvValidationClient = Pick<
  Prisma.TransactionClient,
  | "salesSku"
  | "shopeeProduct"
  | "shopeeProductVariant"
  | "marketplaceSkuMapping"
>;

async function validateCsvRows(
  rows: MappingCsvRow[],
  client: CsvValidationClient = prisma,
): Promise<CsvValidation[]> {
  const skuCodes = [...new Set(rows.map((row) => row.salesSkuCode))];
  const skus = await client.salesSku.findMany({
    where: { code: { in: skuCodes }, active: true },
    select: { id: true, code: true },
  });
  const skuIds = new Map(skus.map((sku) => [sku.code, sku.id]));
  const validations = await Promise.all(
    rows.map(async (row) => {
      const errors: string[] = [];
      const salesSkuId = skuIds.get(row.salesSkuCode) ?? null;
      if (!salesSkuId)
        errors.push(
          `SalesSku ${row.salesSkuCode} does not exist or is archived.`,
        );
      try {
        const offerKey = await resolveShopeeOffer(
          {
            platform: row.platform,
            shopId: row.shopId,
            externalProductId: row.externalProductId,
            externalVariantId: row.externalVariantId,
            offerKind: "variant",
          },
          client,
        );
        const existing = await client.marketplaceSkuMapping.findMany({
          where: { platform: row.platform, shopId: row.shopId, offerKey },
        });
        if (
          existing.some((mapping) =>
            intervalsOverlap(mapping, {
              effectiveFrom: new Date(row.effectiveFrom),
              effectiveTo: null,
            }),
          )
        )
          errors.push(
            "overlaps an existing confirmed interval; use a correction instead.",
          );
        return { valid: !errors.length, errors, offerKey, salesSkuId };
      } catch (error) {
        errors.push(
          error instanceof Error
            ? error.message
            : "source offer could not be resolved",
        );
        return { valid: false, errors, offerKey: null, salesSkuId };
      }
    }),
  );
  for (const error of csvIntraFileConflicts(rows)) {
    const rowNumber = Number(error.match(/^Row (\d+)/)?.[1]);
    const validation =
      validations[rows.findIndex((row) => row.rowNumber === rowNumber)];
    if (validation) {
      validation.errors.push(error.replace(/^Row \d+: /, ""));
      validation.valid = false;
    }
  }
  return validations;
}

export async function createCsvMappingDraft(
  input: { csv: string; filename: string; idempotencyKey: string },
  actorId: string,
) {
  const sourceHash = fingerprint(input.csv);
  const payloadFingerprint = fingerprint(
    JSON.stringify({ filename: input.filename, sourceHash }),
  );
  const prior = await prisma.marketplaceSkuMappingCsvImportBatch.findUnique({
    where: {
      actorId_idempotencyKey: { actorId, idempotencyKey: input.idempotencyKey },
    },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (prior) {
    if (prior.payloadFingerprint !== payloadFingerprint)
      throw new Error(
        "This idempotency key was already used for a different CSV draft.",
      );
    return prior;
  }
  const parsed = parseMappingCsv(input.csv);
  const validations = await validateCsvRows(parsed.rows);
  const validationSnapshot = {
    errors: parsed.errors,
    valid:
      !parsed.errors.length &&
      validations.every((validation) => validation.valid),
    createdAt: new Date().toISOString(),
  };
  try {
    return await prisma.marketplaceSkuMappingCsvImportBatch.create({
      data: {
        actorId,
        filename: input.filename,
        sourceHash,
        payloadFingerprint,
        idempotencyKey: input.idempotencyKey,
        validationSnapshot,
        rows: {
          create: parsed.rows.map((row, index) => {
            const result = validations[index]!;
            return {
              ...row,
              effectiveFrom: new Date(row.effectiveFrom),
              offerKey: result.offerKey,
              salesSkuId: result.salesSkuId,
              validationSnapshot: result,
            };
          }),
        },
      },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });
  } catch (error) {
    const replay = await prisma.marketplaceSkuMappingCsvImportBatch.findUnique({
      where: {
        actorId_idempotencyKey: {
          actorId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });
    if (replay?.payloadFingerprint === payloadFingerprint) return replay;
    throw error;
  }
}

export async function getCsvMappingDraft(batchId: string, actorId: string) {
  const batch = await prisma.marketplaceSkuMappingCsvImportBatch.findFirst({
    where: { id: batchId, actorId },
    include: {
      rows: {
        orderBy: { rowNumber: "asc" },
        include: { salesSku: { select: { code: true } } },
      },
    },
  });
  if (!batch) throw new Error("CSV draft not found.");
  return batch;
}

export async function commitCsvMappingDraft(
  batchId: string,
  idempotencyKey: string,
  actorId: string,
) {
  const batch = await getCsvMappingDraft(batchId, actorId);
  const commitFingerprint = fingerprint(
    JSON.stringify({ batchId, operation: "commit" }),
  );
  if (batch.commitIdempotencyKey) {
    if (
      batch.commitIdempotencyKey !== idempotencyKey ||
      batch.commitPayloadFingerprint !== commitFingerprint
    )
      throw new Error(
        "This CSV draft was already committed with a different idempotency operation.",
      );
    return batch;
  }
  const rows = batch.rows.map((row) => ({
    rowNumber: row.rowNumber,
    platform: "shopee" as const,
    shopId: row.shopId,
    externalProductId: row.externalProductId,
    externalVariantId: row.externalVariantId,
    salesSkuCode: row.salesSkuCode,
    effectiveFrom: row.effectiveFrom.toISOString(),
  }));
  // Offer keys are derivable from immutable draft identities, so locks can be
  // acquired before checking source ownership and current mapping state.
  const locks = rows.map((row) => ({
    platform: row.platform,
    shopId: row.shopId,
    offerKey: canonicalShopeeOffer({
      externalProductId: row.externalProductId,
      externalVariantId: row.externalVariantId,
      offerKind: "variant",
    }).offerKey,
  }));
  return withOfferLocks(locks, async (tx) => {
    const current = await tx.marketplaceSkuMappingCsvImportBatch.findFirst({
      where: { id: batchId, actorId },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });
    if (!current)
      throw new Error("This CSV draft is no longer available to commit.");
    if (current.status === "committed") {
      if (
        current.commitIdempotencyKey === idempotencyKey &&
        current.commitPayloadFingerprint === commitFingerprint
      )
        return current;
      throw new Error(
        "This CSV draft was already committed with a different idempotency operation.",
      );
    }
    if (!(current.validationSnapshot as { valid?: boolean }).valid)
      throw new Error(
        "This CSV draft is invalid. Review its row errors and create a new draft.",
      );
    const currentRows = current.rows.map((row) => ({
      rowNumber: row.rowNumber,
      platform: "shopee" as const,
      shopId: row.shopId,
      externalProductId: row.externalProductId,
      externalVariantId: row.externalVariantId,
      salesSkuCode: row.salesSkuCode,
      effectiveFrom: row.effectiveFrom.toISOString(),
    }));
    const validation = await validateCsvRows(currentRows, tx);
    if (validation.some((item) => !item.valid))
      throw new Error(
        "This CSV draft is stale. Its source offer, Sales SKU, or mapping conflict changed after review.",
      );
    const mappings = [];
    for (const [index, row] of currentRows.entries()) {
      mappings.push(
        await tx.marketplaceSkuMapping.create({
          data: {
            platform: row.platform,
            shopId: row.shopId,
            offerKey: validation[index]!.offerKey!,
            externalProductId: row.externalProductId,
            externalVariantId: row.externalVariantId,
            offerKind: "variant",
            salesSkuId: validation[index]!.salesSkuId!,
            effectiveFrom: new Date(row.effectiveFrom),
            createdById: actorId,
          },
        }),
      );
    }
    await tx.marketplaceSkuMappingEvent.createMany({
      data: mappings.map((mapping) => ({
        mappingId: mapping.id,
        eventType: "csv-confirmed",
        actorId,
        detail: { batchId },
      })),
    });
    for (const [index, mapping] of mappings.entries()) {
      await tx.marketplaceSkuMappingCsvImportRow.update({
          where: {
            batchId_rowNumber: {
              batchId,
              rowNumber: currentRows[index]!.rowNumber,
            },
          },
          data: {
            mappingResult: {
              mappingId: mapping.id,
              committedAt: new Date().toISOString(),
            },
          },
      });
    }
    return tx.marketplaceSkuMappingCsvImportBatch.update({
      where: { id: batchId },
      data: {
        status: "committed",
        committedAt: new Date(),
        commitIdempotencyKey: idempotencyKey,
        commitPayloadFingerprint: commitFingerprint,
      },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });
  });
}

export async function earliestEligibleSale(
  input: Omit<ConfirmMappingInput, "salesSkuId" | "effectiveFrom">,
) {
  const canonical = canonicalShopeeOffer(input);
  if (input.offerKind === "variant") {
    const where = {
      order: {
        shopId: input.shopId,
        orderStatus: { notIn: ["CANCELLED", "UNPAID"] },
        shopeeCreatedAt: { not: null },
      },
    };
    const line = await prisma.shopeeOrderItem.findFirst({
      where: {
        ...where,
        OR: [
          { shopeeItemId: Number(canonical.externalProductId) },
          {
            shopeeItemId: null,
            variant: {
              is: { shopeeItemId: Number(canonical.externalProductId) },
            },
          },
        ],
        shopeeModelId: Number(canonical.externalVariantId),
      },
      orderBy: { order: { shopeeCreatedAt: "asc" } },
      select: { order: { select: { shopeeCreatedAt: true } } },
    });
    return line?.order.shopeeCreatedAt ?? null;
  }
  const { lines } = await nonvariantLinesForOffer(input);
  const line = lines.find((value) => value.order.shopeeCreatedAt);
  return line?.order.shopeeCreatedAt ?? null;
}

export async function previewMapping(
  input: Omit<ConfirmMappingInput, "effectiveFrom"> & {
    effectiveFrom?: Date;
    excludeMappingId?: string;
  },
) {
  const offerKey = await resolveShopeeOffer(input);
  const effectiveFrom =
    input.effectiveFrom ?? (await earliestEligibleSale(input));
  if (!effectiveFrom)
    throw new Error(
      "No eligible Shopee sale was found for this offer. Choose an effective date explicitly.",
    );
  const nonvariant =
    input.offerKind === "verified-product"
      ? await nonvariantLinesForOffer(input, effectiveFrom)
      : null;
  const canonical = canonicalShopeeOffer(input);
  const lines =
    nonvariant?.lines ??
    (await prisma.shopeeOrderItem.findMany({
      where: {
        shopeeModelId: Number(canonical.externalVariantId),
        OR: [
          { shopeeItemId: Number(canonical.externalProductId) },
          {
            shopeeItemId: null,
            variant: {
              is: { shopeeItemId: Number(canonical.externalProductId) },
            },
          },
        ],
        order: {
          shopId: input.shopId,
          orderStatus: { notIn: ["CANCELLED", "UNPAID"] },
          shopeeCreatedAt: { gte: effectiveFrom },
        },
      },
      select: {
        quantity: true,
        subtotal: true,
        order: { select: { currency: true, shopeeCreatedAt: true } },
      },
    }));
  const nativeRevenueByCurrency: Record<
    string,
    { minorUnits: string; scale: number }
  > = {};
  for (const line of lines) {
    const currency = line.order.currency ?? "UNKNOWN";
    const value = toMinorUnits(line.subtotal, currency);
    const bucket = nativeRevenueByCurrency[currency] ?? {
      minorUnits: "0",
      scale: currencyScale(currency),
    };
    bucket.minorUnits = (BigInt(bucket.minorUnits) + value).toString();
    nativeRevenueByCurrency[currency] = bucket;
  }
  const dates = lines
    .map((line) => line.order.shopeeCreatedAt)
    .filter((date): date is Date => Boolean(date));
  const mappings = await prisma.marketplaceSkuMapping.findMany({
    where: { platform: input.platform, shopId: input.shopId, offerKey },
    select: { id: true, effectiveFrom: true, effectiveTo: true },
  });
  const excludedMapping = mappings.find(
    (mapping) => mapping.id === input.excludeMappingId,
  );
  const hasOverlap = mappings.some(
    (mapping) =>
      mapping.id !== input.excludeMappingId &&
      intervalsOverlap(mapping, { effectiveFrom, effectiveTo: null }),
  );
  const overlapWarning =
    excludedMapping && effectiveFrom <= excludedMapping.effectiveFrom
      ? "A correction must begin after the original effective date."
      : hasOverlap
        ? "This effective date overlaps an existing confirmed mapping for this offer."
        : null;
  const unverifiableLegacyLines = nonvariant?.unverifiableLegacyLines ?? 0;
  const legacyWarning = unverifiableLegacyLines
    ? ` ${unverifiableLegacyLines} legacy non-variant line${unverifiableLegacyLines === 1 ? " is" : "s are"} excluded because no unique same-shop catalog identity could be verified.`
    : "";
  return {
    offerKey,
    effectiveFrom,
    affectedLines: lines.length,
    affectedUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
    nativeRevenueByCurrency,
    dateRange: dates.length
      ? {
          from: new Date(Math.min(...dates.map(Number))),
          to: new Date(Math.max(...dates.map(Number))),
        }
      : null,
    overlapWarning,
    unverifiableLegacyLines,
    exclusionWarning: `Cancelled and unpaid orders are excluded from this preview.${legacyWarning}`,
  };
}

const currencyScale = (currency: string) =>
  ({ JPY: 0, KRW: 0, KWD: 3, BHD: 3, OMR: 3, TND: 3 })[
    currency.toUpperCase()
  ] ?? 2;
const toMinorUnits = (value: number, currency: string) =>
  BigInt(Math.round(value * 10 ** currencyScale(currency)));

export async function correctMapping(
  mappingId: string,
  salesSkuId: string,
  effectiveFrom: Date,
  actorId: string,
) {
  const mapping = await prisma.marketplaceSkuMapping.findUnique({
    where: { id: mappingId },
    select: { platform: true, shopId: true, offerKey: true },
  });
  if (!mapping) throw new Error("Only an active mapping can be corrected.");
  return withOfferLock(mapping, mapping.offerKey, async (tx) => {
    const old = await tx.marketplaceSkuMapping.findUnique({
      where: { id: mappingId },
    });
    if (!old || old.effectiveTo)
      throw new Error("Only an active mapping can be corrected.");
    const salesSku = await tx.salesSku.findUnique({
      where: { id: salesSkuId },
      select: { id: true, active: true },
    });
    if (!salesSku || !salesSku.active)
      throw new Error("The selected active Sales SKU does not exist.");
    if (effectiveFrom <= old.effectiveFrom)
      throw new Error(
        "A correction must begin after the original effective date; correcting an earlier period requires an explicit non-overlapping historical mapping.",
      );
    const overlap = await tx.marketplaceSkuMapping.findFirst({
      where: {
        platform: old.platform,
        shopId: old.shopId,
        offerKey: old.offerKey,
        id: { not: old.id },
        effectiveTo: null,
      },
    });
    if (overlap) throw new Error("This offer has another active mapping.");
    const closeAt = new Date(effectiveFrom.getTime() - 1);
    await tx.marketplaceSkuMapping.update({
      where: { id: old.id },
      data: { effectiveTo: closeAt },
    });
    const replacement = await tx.marketplaceSkuMapping.create({
      data: {
        platform: old.platform,
        shopId: old.shopId,
        offerKey: old.offerKey,
        externalProductId: old.externalProductId,
        externalVariantId: old.externalVariantId,
        offerKind: old.offerKind,
        salesSkuId,
        effectiveFrom,
        createdById: actorId,
        supersedesId: old.id,
      },
    });
    await tx.marketplaceSkuMappingEvent.createMany({
      data: [
        {
          mappingId: old.id,
          eventType: "closed-for-correction",
          actorId,
          detail: { effectiveTo: closeAt.toISOString() },
        },
        {
          mappingId: replacement.id,
          eventType: "correction-confirmed",
          actorId,
          detail: { supersedesId: old.id },
        },
      ],
    });
    return replacement;
  });
}

export async function rejectCandidate(candidateId: string, actorId: string) {
  const candidate = await prisma.marketplaceSkuCandidate.findUnique({
    where: { id: candidateId },
  });
  if (!candidate || candidate.status !== "open")
    throw new Error("Only an open candidate can be rejected.");
  return prisma.marketplaceSkuCandidate.update({
    where: { id: candidateId },
    data: {
      status: "dismissed",
      reviewedAt: new Date(),
      reviewedById: actorId,
    },
  });
}

export async function createRecipe(
  input: {
    salesSkuId: string;
    name: string;
    effectiveFrom: Date;
    effectiveTo?: Date | null;
    components: { productId: string; quantity: number }[];
  },
  actorId: string,
) {
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
    throw new Error("The recipe end date must not precede its start date.");
  if (
    !input.components.length ||
    input.components.some(
      (component) =>
        !Number.isInteger(component.quantity) || component.quantity <= 0,
    )
  )
    throw new Error(
      "A recipe needs one or more products with a positive whole quantity.",
    );
  if (
    new Set(input.components.map((component) => component.productId)).size !==
    input.components.length
  )
    throw new Error("A product can appear only once in a recipe.");
  return prisma.$transaction(async (tx) => {
    const sku = await tx.salesSku.findUnique({
      where: { id: input.salesSkuId },
      select: { id: true, active: true },
    });
    if (!sku || !sku.active)
      throw new Error("The selected active Sales SKU does not exist.");
    const products = await tx.product.count({
      where: {
        id: { in: input.components.map((component) => component.productId) },
      },
    });
    if (products !== input.components.length)
      throw new Error("One or more recipe products do not exist.");
    const existing = await tx.salesSkuRecipe.findMany({
      where: { salesSkuId: input.salesSkuId, status: "confirmed" },
    });
    if (
      existing.some((recipe) =>
        intervalsOverlap(recipe, {
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
        }),
      )
    )
      throw new Error(
        "This Sales SKU already has a recipe overlapping the requested effective dates.",
      );
    return tx.salesSkuRecipe.create({
      data: {
        salesSkuId: input.salesSkuId,
        name: input.name,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        createdById: actorId,
        components: { create: input.components },
      },
      include: { components: true },
    });
  });
}
