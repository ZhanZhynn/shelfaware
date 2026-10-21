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
  const feeName = sourceIdentifier(row.fee_name);
  const orderNumber = sourceIdentifier(row.order_no);
  const lineNumber = sourceIdentifier(row.orderItem_no);
  const digest = createHash("sha256").update(JSON.stringify([transactionNumber, feeType, feeName, orderNumber, lineNumber])).digest("hex");
  return { externalId: `finance:v3:${digest}`, legacyExternalId: lazadaFinanceLegacyIdentity({ transaction_number: transactionNumber, fee_type: feeType, order_no: orderNumber, orderItem_no: lineNumber }), transactionNumber, feeType, feeName, orderNumber, lineNumber };
}

export function lazadaFinanceLegacyIdentity(row: Record<string, unknown>) {
  const transactionNumber = sourceIdentifier(row.transaction_number);
  if (!transactionNumber) throw new LazadaProviderError("MISSING_FINANCE_TRANSACTION_ID", 502);
  const feeType = sourceIdentifier(row.fee_type), orderNumber = sourceIdentifier(row.order_no), lineNumber = sourceIdentifier(row.orderItem_no);
  const digest = createHash("sha256").update(JSON.stringify([transactionNumber, feeType, orderNumber, lineNumber])).digest("hex");
  return `finance:v2:${digest}`;
}

export function lazadaFinanceSameComponent(left: Record<string, unknown>, right: Record<string, unknown>) {
  const a = [sourceIdentifier(left.transaction_number), sourceIdentifier(left.fee_type), sourceIdentifier(left.fee_name), sourceIdentifier(left.order_no), sourceIdentifier(left.orderItem_no)];
  const b = [sourceIdentifier(right.transaction_number), sourceIdentifier(right.fee_type), sourceIdentifier(right.fee_name), sourceIdentifier(right.order_no), sourceIdentifier(right.orderItem_no)];
  return a[0] !== null && a.every((value, index) => value === b[index]);
}
