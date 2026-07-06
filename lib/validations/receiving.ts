import { z } from "zod";

export const receiveItemSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().optional(),
  quantity: z.number().int().positive("Quantity must be a positive integer"),
  poItemId: z.string().optional(),
  notes: z.string().optional(),
});

export const receiveBodySchema = z.object({
  warehouseId: z.string().min(1, "Warehouse ID is required"),
  poId: z.string().optional(),
  items: z.array(receiveItemSchema).min(1, "At least one item is required"),
  notes: z.string().optional(),
});

export type ReceiveBody = z.infer<typeof receiveBodySchema>;
