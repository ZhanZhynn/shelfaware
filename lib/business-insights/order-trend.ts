import type { CombinedOrder } from "@/lib/server/combined-orders-data";

type RevenueValue = number | null;
export type OrderTrendMonth = {
  month: string;
  totalValue: RevenueValue;
  orderCount: number;
  wmsValue: RevenueValue;
  wmsCount: number;
  shopeeValue: RevenueValue;
  shopeeCount: number;
  lazadaValue: RevenueValue;
  lazadaCount: number;
};
type OrderTrendAccumulator = Omit<OrderTrendMonth, "month"> & { totalUnknown: boolean; wmsUnknown: boolean; shopeeUnknown: boolean; lazadaUnknown: boolean };

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Keeps a missing source total distinct from a verified zero in chart data. */
export function buildOrderTrendByMonth(orders: CombinedOrder[]): OrderTrendMonth[] {
  const byMonth = new Map<string, OrderTrendAccumulator>();
  for (const order of orders) {
    const date = new Date(order.createdAt);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const current = byMonth.get(key) ?? { totalValue: 0, orderCount: 0, wmsValue: 0, wmsCount: 0, shopeeValue: 0, shopeeCount: 0, lazadaValue: 0, lazadaCount: 0, totalUnknown: false, wmsUnknown: false, shopeeUnknown: false, lazadaUnknown: false };
    current.orderCount++;
    if (order.source === "wms") current.wmsCount++;
    if (order.source === "shopee") current.shopeeCount++;
    if (order.source === "lazada") current.lazadaCount++;
    if (order.total === null) {
      current.totalUnknown = true;
      if (order.source === "wms") current.wmsUnknown = true;
      if (order.source === "shopee") current.shopeeUnknown = true;
      if (order.source === "lazada") current.lazadaUnknown = true;
    } else {
      current.totalValue = (current.totalValue ?? 0) + order.total;
      if (order.source === "wms") current.wmsValue = (current.wmsValue ?? 0) + order.total;
      if (order.source === "shopee") current.shopeeValue = (current.shopeeValue ?? 0) + order.total;
      if (order.source === "lazada") current.lazadaValue = (current.lazadaValue ?? 0) + order.total;
    }
    byMonth.set(key, current);
  }
  const dataYear = orders[0]?.createdAt ? new Date(orders[0].createdAt).getUTCFullYear() : new Date().getUTCFullYear();
  return months.map((month, index) => {
    const value = byMonth.get(`${dataYear}-${String(index + 1).padStart(2, "0")}`);
    if (!value) return { month, totalValue: 0, orderCount: 0, wmsValue: 0, wmsCount: 0, shopeeValue: 0, shopeeCount: 0, lazadaValue: 0, lazadaCount: 0 };
    return { month, totalValue: value.totalUnknown ? null : value.totalValue, orderCount: value.orderCount, wmsValue: value.wmsUnknown ? null : value.wmsValue, wmsCount: value.wmsCount, shopeeValue: value.shopeeUnknown ? null : value.shopeeValue, shopeeCount: value.shopeeCount, lazadaValue: value.lazadaUnknown ? null : value.lazadaValue, lazadaCount: value.lazadaCount };
  });
}
