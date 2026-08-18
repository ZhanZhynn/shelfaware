import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable();
const httpUrl = z
  .string()
  .trim()
  .url("Enter a valid URL")
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "URL must use http or https");
const optionalHttpUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  httpUrl.optional().nullable(),
);
const httpUrls = z.array(httpUrl).max(8).optional().default([]);
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional().nullable(),
  );
const optionalDate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional().nullable(),
);
const optionalDateTime = z.preprocess(
  (value) => (value === "" ? null : value),
  z.coerce.date().optional().nullable(),
);
const stringList = z
  .array(z.string().trim().min(1).max(200))
  .max(20)
  .optional()
  .default([]);
const priceBreak = z.object({
  minQuantity: z.coerce.number().int().positive(),
  unitPriceRmb: z.coerce.number().nonnegative(),
});
const sourcingVariant = z
  .object({
    size: optionalText(200),
    material: optionalText(200),
    colour: optionalText(200),
    requestedQuantity: z.coerce.number().int().positive("Quantity is required"),
    targetUnitPriceMyr: optionalNumber(z.coerce.number().nonnegative()),
  })
  .refine((variant) => variant.size || variant.material || variant.colour, {
    message: "Each variant needs a size, material, or colour",
  });

export const sourcingCaseSchema = z.object({
  workspaceId: z.string().min(1, "Workspace is required"),
  title: z.string().trim().min(1, "Product/request name is required").max(200),
  description: optionalText(2000),
  photoUrls: httpUrls,
  size: optionalText(200),
  material: optionalText(200),
  variant: optionalText(200),
  specifications: optionalText(4000),
  referenceUrl: optionalHttpUrl,
  notes: optionalText(4000),
  requestedQuantity: optionalNumber(z.coerce.number().int().positive()),
  targetUnitPriceMyr: optionalNumber(z.coerce.number().nonnegative()),
  assignedToId: z.string().min(1).optional().nullable(),
  variants: z.array(sourcingVariant).max(200).default([]),
});

export const sourcingRequestUpdateSchema = sourcingCaseSchema
  .omit({ workspaceId: true, photoUrls: true, assignedToId: true })
  .extend({ version: z.number().int().positive() });

export const sourcingQuoteSchema = z.object({
  supplierId: z.string().min(1).optional().nullable(),
  supplierName: z.string().trim().min(1, "Supplier is required").max(200),
  unitPriceRmb: z.coerce.number().nonnegative("Price cannot be negative"),
  piecesPerSellingUnit: optionalNumber(z.coerce.number().int().positive()),
  cartonLengthCm: optionalNumber(z.coerce.number().positive()),
  cartonWidthCm: optionalNumber(z.coerce.number().positive()),
  cartonHeightCm: optionalNumber(z.coerce.number().positive()),
  piecesPerCarton: optionalNumber(z.coerce.number().int().positive()),
  marketPriceMyr: optionalNumber(z.coerce.number().positive()),
  marketPack: optionalNumber(z.coerce.number().int().positive()),
  overrideCostMyr: optionalNumber(z.coerce.number().positive()),
  moq: optionalNumber(z.coerce.number().int().positive()),
  unitsPerCarton: optionalNumber(z.coerce.number().int().positive()),
  cartonDimensions: optionalText(200),
  cartonWeightKg: optionalNumber(z.coerce.number().nonnegative()),
  leadTimeDays: optionalNumber(z.coerce.number().int().nonnegative()),
  // Native datetime-local inputs intentionally omit a timezone; the server stores the parsed date.
  validUntil: optionalDate,
  samplePhotoUrls: httpUrls,
  paymentTerms: optionalText(500),
  certifications: stringList,
  complianceNotes: optionalText(2000),
  riskLevel: z.enum(["low", "medium", "high"]).optional().nullable(),
  recommendation: optionalText(2000),
  priceBreaks: z.array(priceBreak).max(20).optional().default([]),
  remarks: optionalText(4000),
});
export const sourcingQuoteLineSchema = z
  .object({
    caseVariantId: z.string().min(1),
    availability: z.enum(["available", "unavailable"]),
    unitPriceRmb: optionalNumber(z.coerce.number().positive()),
    piecesPerSellingUnit: optionalNumber(z.coerce.number().int().positive()),
    cartonLengthCm: optionalNumber(z.coerce.number().positive()),
    cartonWidthCm: optionalNumber(z.coerce.number().positive()),
    cartonHeightCm: optionalNumber(z.coerce.number().positive()),
    piecesPerCarton: optionalNumber(z.coerce.number().int().positive()),
    marketPriceMyr: optionalNumber(z.coerce.number().positive()),
    marketPack: optionalNumber(z.coerce.number().int().positive()),
    overrideCostMyr: optionalNumber(z.coerce.number().positive()),
    moq: optionalNumber(z.coerce.number().int().positive()),
    leadTimeDays: optionalNumber(z.coerce.number().int().nonnegative()),
    notes: optionalText(2000),
  })
  .superRefine((line, context) => {
    if (
      line.availability === "available" &&
      !line.unitPriceRmb &&
      !line.overrideCostMyr
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unitPriceRmb"],
        message: "Available variants need a quoted price",
      });
  });

export const sourcingVariantQuoteSheetSchema = z.object({
  supplierId: z.string().min(1).optional().nullable(),
  supplierName: z.string().trim().min(1, "Supplier is required").max(200),
  paymentTerms: optionalText(500),
  leadTimeDays: optionalNumber(z.coerce.number().int().nonnegative()),
  notes: optionalText(4000),
  lines: z.array(sourcingQuoteLineSchema).min(1),
});

export const sourcingVariantSelectionSchema = z
  .object({
    caseVariantId: z.string().min(1),
    quoteLineId: z.string().min(1).optional(),
    status: z.enum(["selected", "skipped"]),
    skipReason: optionalText(1000),
    marketPriceMyr: optionalNumber(z.coerce.number().positive()),
    marketPack: optionalNumber(z.coerce.number().int().positive()),
    marketValidationWaived: z.boolean().optional(),
  })
  .superRefine((selection, context) => {
    if (selection.status === "selected" && !selection.quoteLineId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quoteLineId"],
        message: "Select an offer",
      });
    if (selection.status === "skipped" && !selection.skipReason)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["skipReason"],
        message: "Explain why this variant is skipped",
      });
  });

export const sourcingCommandSchema = z
  .object({
    action: z.enum([
      "assign",
      "create_quote",
      "save_quote",
      "submit_quote",
      "submit_all_drafts",
      "delete_quote",
      "withdraw_quote",
      "request_changes",
      "approve",
      "reject",
      "cannot_source",
      "confirm_order",
      "approve_and_create_order",
      "cancel",
      "archive",
      "revive",
      "repeat",
      "submit_variant_quote",
      "save_variant_quote",
      "confirm_variant_selection",
      "create_variant_orders",
      "request_variant_quote_changes",
      "save_variant_selection",
      "clear_variant_selection",
    ]),
    version: z.number().int().positive(),
    assigneeId: z.string().min(1).optional(),
    quoteId: z.string().min(1).optional(),
    fxRateOverride: z.coerce.number().positive().optional(),
    fxOverrideReason: z.string().trim().min(1).max(500).optional(),
    orderQuantity: z.coerce.number().int().positive().optional(),
    quote: sourcingQuoteSchema.optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    quoteSheet: sourcingVariantQuoteSheetSchema.optional(),
    selections: z.array(sourcingVariantSelectionSchema).optional(),
    selection: sourcingVariantSelectionSchema.optional(),
    caseVariantId: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (
      ["create_quote", "save_quote", "submit_quote"].includes(value.action) &&
      !value.quote
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quote"],
        message: "A valid quote is required",
      });
    }
    if (
      [
        "delete_quote",
        "withdraw_quote",
        "request_changes",
        "approve",
        "approve_and_create_order",
        "reject",
        "request_variant_quote_changes",
      ].includes(value.action) &&
      !value.quoteId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quoteId"],
        message: "A quote must be selected",
      });
    }
    if (
      ["reject", "cannot_source"].includes(value.action) &&
      !value.reason?.trim()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "A reason is required",
      });
    }
    if (value.fxRateOverride && !value.fxOverrideReason?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fxOverrideReason"],
        message: "An exchange-rate override reason is required",
      });
    }
    if (
      ["save_variant_quote", "submit_variant_quote"].includes(value.action) &&
      !value.quoteSheet
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quoteSheet"],
        message: "A supplier quote sheet is required",
      });
    if (
      value.action === "confirm_variant_selection" &&
      !value.selections?.length
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selections"],
        message: "Choose or skip every variant",
      });
    if (value.action === "save_variant_selection" && !value.selection)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selection"],
        message: "A variant selection is required",
      });
    if (value.action === "clear_variant_selection" && !value.caseVariantId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caseVariantId"],
        message: "A variant is required",
      });
  });

export const sourcingCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment is required").max(4000),
  mentionedUserIds: z
    .array(z.string().min(1))
    .max(50)
    .default([])
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Mentioned users must be unique",
    ),
});

export const sourcingNextActionSchema = z.object({
  version: z.number().int().positive(),
  nextAction: optionalText(500),
  nextActionAt: optionalDateTime,
  slaDueAt: optionalDateTime,
});

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const timezone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid IANA timezone");
const slaRuleHours = z.coerce.number().positive().max(720);
export const sourcingSlaSettingsSchema = z.object({
  timezone,
  businessHours: z
    .object({
      start: timeOfDay,
      end: timeOfDay,
      weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    })
    .refine(
      (value) => value.start < value.end,
      "Business-hours end must be after start",
    ),
  rules: z.object({
    first_response: slaRuleHours,
    quote_submission: slaRuleHours,
    approval: slaRuleHours,
    shipment: slaRuleHours,
  }),
  escalation: z.object({
    thresholdHours: z.coerce.number().min(0).max(720),
    recipientIds: z
      .array(z.string().min(1))
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Escalation recipients must be unique",
      ),
  }),
});

const costParameter = z.coerce.number().positive().max(100_000);
const costPercentage = z.coerce.number().min(0).max(99.99);
export const sourcingCostSettingsSchema = z
  .object({
    fxCnyMyr: costParameter,
    productCostMultiplier: costParameter,
    shippingRateMyrPerM3: costParameter,
    shopeeFeePercent: costPercentage,
    fulfilmentFeePercent: costPercentage,
    goldMarkup: costParameter,
    tier2Markup: costParameter,
    razorMarkup: costParameter,
  })
  .refine(
    (value) => value.shopeeFeePercent + value.fulfilmentFeePercent < 100,
    {
      message: "Marketplace and fulfilment fees must total less than 100%",
      path: ["fulfilmentFeePercent"],
    },
  );

export type SourcingCaseInput = z.infer<typeof sourcingCaseSchema>;
export type SourcingRequestUpdateInput = z.infer<
  typeof sourcingRequestUpdateSchema
>;
export type SourcingQuoteInput = z.infer<typeof sourcingQuoteSchema>;
export type SourcingVariantQuoteSheetInput = z.infer<
  typeof sourcingVariantQuoteSheetSchema
>;
export type SourcingVariantSelectionInput = z.infer<
  typeof sourcingVariantSelectionSchema
>;
export type SourcingCommentInput = z.infer<typeof sourcingCommentSchema>;
export type SourcingNextActionInput = z.infer<typeof sourcingNextActionSchema>;
export type SourcingSlaSettingsInput = z.infer<
  typeof sourcingSlaSettingsSchema
>;
export type SourcingCostSettingsInput = z.infer<
  typeof sourcingCostSettingsSchema
>;
