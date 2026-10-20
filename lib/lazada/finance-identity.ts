import { createHash } from "crypto";
import { LazadaProviderError } from "./provider-error";

function sourceIdentifier(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;
}

/** A transaction group can contain several source fee components. Amount/date
 * changes must update that component, never manufacture another monetary row. */
export function lazadaFinanceIdentity(row: Record<string, unknown>) {
  const transactionNumber = sourceIdentifier(row.transaction_number);
  if (!transactionNumber) throw new LazadaProviderError("MISSING_FINANCE_TRANSACTION_ID", 502);
  const feeType = sourceIdentifier(row.fee_type);
  const orderNumber = sourceIdentifier(row.order_no);
  const lineNumber = sourceIdentifier(row.orderItem_no);
  const digest = createHash("sha256").update(JSON.stringify([transactionNumber, feeType, orderNumber, lineNumber])).digest("hex");
  return { externalId: `finance:v2:${digest}`, transactionNumber, feeType, orderNumber, lineNumber };
}
