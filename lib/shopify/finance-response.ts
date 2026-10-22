import { z } from "zod";

const money = z.object({ shopMoney: z.object({ amount: z.string(), currencyCode: z.string().min(1) }) });
const transaction = z.object({
  id: z.string().min(1), kind: z.string(), status: z.string(), gateway: z.string().nullable(),
  createdAt: z.string(), processedAt: z.string().nullable(), amountSet: money,
});
const financeResponse = z.object({
  orders: z.object({
    nodes: z.array(z.object({
      id: z.string().min(1), updatedAt: z.string(), transactions: z.array(transaction),
      refunds: z.array(z.object({
        id: z.string().min(1), createdAt: z.string(), processedAt: z.string(),
        totalRefundedSet: money, transactions: z.object({ nodes: z.array(transaction) }),
      })),
    })),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }),
});

// Validate without transforming monetary strings or silently defaulting missing lists.
export const isShopifyFinanceResponse = (data: unknown): boolean => financeResponse.safeParse(data).success;
