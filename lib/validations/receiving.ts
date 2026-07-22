import { z } from "zod";

export const receiveItemSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().optional(),
  quantity: z.number().int().nonnegative().optional(), // Legacy accepted quantity field
  acceptedQuantity: z.number().int().nonnegative().optional(),
  damagedQuantity: z.number().int().nonnegative().default(0),
  shortageQuantity: z.number().int().nonnegative().default(0),
  poItemId: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((item, context) => {
  const accepted = item.acceptedQuantity ?? item.quantity ?? 0;
  if (accepted + item.damagedQuantity + item.shortageQuantity < 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one received, damaged, or shortage unit is required" });
});

export const receiveBodySchema = z.object({
  warehouseId: z.string().min(1, "Warehouse ID is required"),
  poId: z.string().optional(),
  items: z.array(receiveItemSchema).min(1, "At least one item is required"),
  notes: z.string().optional(),
});

export type ReceiveBody = z.infer<typeof receiveBodySchema>;
