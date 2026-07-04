"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ShopeeOrderStatusChartProps {
  data: Record<string, number>;
}

const STATUS_COLORS: Record<string, string> = {
  UNPAID: "#f59e0b",
  READY_TO_SHIP: "#3b82f6",
  PROCESSED: "#8b5cf6",
  SHIPPED: "#6366f1",
  COMPLETED: "#22c55e",
  CANCELLED: "#ef4444",
  INVOICE_PENDING: "#f97316",
  PENDING: "#f59e0b",
  CONFIRMED: "#3b82f6",
  PROCESSING: "#8b5cf6",
  DELIVERED: "#22c55e",
  REFUNDED: "#ef4444",
};

const STATUS_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  READY_TO_SHIP: "Ready to Ship",
  PROCESSED: "Processed",
  SHIPPED: "Shipped",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  INVOICE_PENDING: "Invoice Pending",
  PENDING: "Unpaid",
  CONFIRMED: "Ready to Ship",
  PROCESSING: "Processed",
  DELIVERED: "Completed",
  REFUNDED: "Cancelled",
};

function normalizeStatus(raw: string): string {
  const upper = raw.toUpperCase();
  // Exact match first
  if (STATUS_LABELS[upper]) return STATUS_LABELS[upper];
  // Match common Shopee long-form descriptions
  if (upper.includes("ORDER RECEIVED")) return "Order Received";
  if (upper.includes("READY TO SHIP") || upper.includes("TO_SHIP")) return "Ready to Ship";
  if (upper.includes("PROCESSED")) return "Processed";
  if (upper.includes("SHIPPED")) return "Shipped";
  if (upper.includes("COMPLETED")) return "Completed";
  if (upper.includes("CANCELLED") || upper.includes("CANCELED")) return "Cancelled";
  if (upper.includes("UNPAID")) return "Unpaid";
  if (upper.includes("RETURN") || upper.includes("REFUND")) return "Return/Refund";
  if (upper.includes("INVOICE")) return "Invoice Pending";
  return raw;
}

export default function ShopeeOrderStatusChart({ data }: ShopeeOrderStatusChartProps) {
  // Build chart data, merging statuses that normalize to the same label
  const merged: Record<string, { value: number; color: string }> = {};
  for (const [status, count] of Object.entries(data)) {
    const name = normalizeStatus(status);
    if (!merged[name]) {
      merged[name] = { value: 0, color: STATUS_COLORS[status.toUpperCase()] || "#6b7280" };
    }
    merged[name].value += count;
  }
  const chartData = Object.entries(merged)
    .map(([name, { value, color }]) => ({ name, value, color }))
    .filter((d) => d.value > 0);

  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Orders by Status</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[250px] text-muted-foreground">
            No order data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [`${Number(value)} orders`, "Count"]}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
