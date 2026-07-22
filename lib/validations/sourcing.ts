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
  route: z.enum(["yiwu", "other"]).default("yiwu"),
  assignedToId: z.string().min(1).optional().nullable(),
});

export const sourcingQuoteSchema = z.object({
  supplierId: z.string().min(1).optional().nullable(),
  supplierName: z.string().trim().min(1, "Supplier is required").max(200),
  unitPriceRmb: z.coerce.number().nonnegative("Price cannot be negative"),
  moq: optionalNumber(z.coerce.number().int().positive()),
  unitsPerCarton: optionalNumber(z.coerce.number().int().positive()),
  cartonDimensions: optionalText(200),
  cartonWeightKg: optionalNumber(z.coerce.number().nonnegative()),
  leadTimeDays: optionalNumber(z.coerce.number().int().nonnegative()),
  // Native datetime-local inputs intentionally omit a timezone; the server stores the parsed date.
  validUntil: optionalDate,
  samplePhotoUrls: httpUrls,
  remarks: optionalText(4000),
});

export const sourcingCommandSchema = z
  .object({
    action: z.enum([
      "assign",
      "save_quote",
      "submit_quote",
      "request_changes",
      "approve",
      "reject",
      "cannot_source",
      "confirm_order",
      "archive",
      "revive",
      "repeat",
    ]),
    version: z.number().int().positive(),
    assigneeId: z.string().min(1).optional(),
    quoteId: z.string().min(1).optional(),
    fxRateOverride: z.coerce.number().positive().optional(),
    fxOverrideReason: z.string().trim().min(1).max(500).optional(),
    quote: sourcingQuoteSchema.optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((value, context) => {
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
  });

export type SourcingCaseInput = z.infer<typeof sourcingCaseSchema>;
export type SourcingQuoteInput = z.infer<typeof sourcingQuoteSchema>;
