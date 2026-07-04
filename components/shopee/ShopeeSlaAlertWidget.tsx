"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, CheckCircle, Package } from "lucide-react";
import Link from "next/link";

interface SlaOrder {
  id: string;
  orderId: string;
  orderStatus: string;
  shipByDate: string | null;
  hoursRemaining: number;
  urgency: "critical" | "high" | "medium";
  buyerUsername: string | null;
  totalAmount: number;
  packageNumber: string | null;
  fulfillmentStatus: string | null;
  daysToShip: number | null;
}

const URGENCY_CONFIG = {
  critical: {
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    dot: "bg-red-500",
    label: "< 6h",
  },
  high: {
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    dot: "bg-orange-500",
    label: "< 12h",
  },
  medium: {
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    dot: "bg-yellow-500",
    label: "< 24h",
  },
};

function formatHoursRemaining(hours: number): string {
  if (hours < 0) return `${Math.abs(hours).toFixed(1)}h overdue`;
  if (hours < 1) return `${Math.round(hours * 60)}m left`;
  return `${hours.toFixed(1)}h left`;
}

export default function ShopeeSlaAlertWidget() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["shopee", "near-sla"],
    queryFn: async () => {
      const response = await apiClient.shopee.getNearSlaOrders(24);
      return response.data;
    },
    enabled: isMounted,
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  if (!isMounted) {
    return <Skeleton className="h-48 w-full" />;
  }

  const orders: SlaOrder[] = data?.orders || [];
  const total = data?.total || 0;

  const criticalCount = orders.filter((o) => o.urgency === "critical").length;
  const highCount = orders.filter((o) => o.urgency === "high").length;
  const mediumCount = orders.filter((o) => o.urgency === "medium").length;

  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Clock className="h-5 w-5" />
          Shipping SLA Alerts
          {total > 0 && (
            <Badge variant="destructive" className="ml-2">
              {total}
            </Badge>
          )}
        </CardTitle>
        <Link
          href="/admin/shopee/orders"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all orders →
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : total === 0 ? (
          <div className="flex items-center gap-3 py-6">
            <CheckCircle className="h-8 w-8 text-green-500" />
            <div>
              <p className="font-medium text-green-500">All Clear</p>
              <p className="text-sm text-muted-foreground">
                No orders approaching their ship-by deadline
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary badges */}
            <div className="flex gap-2 flex-wrap">
              {criticalCount > 0 && (
                <Badge
                  variant="outline"
                  className={`${URGENCY_CONFIG.critical.bg} ${URGENCY_CONFIG.critical.border} ${URGENCY_CONFIG.critical.color}`}
                >
                  <span
                    className={`mr-1.5 h-2 w-2 rounded-full ${URGENCY_CONFIG.critical.dot}`}
                  />
                  {criticalCount} Critical
                </Badge>
              )}
              {highCount > 0 && (
                <Badge
                  variant="outline"
                  className={`${URGENCY_CONFIG.high.bg} ${URGENCY_CONFIG.high.border} ${URGENCY_CONFIG.high.color}`}
                >
                  <span
                    className={`mr-1.5 h-2 w-2 rounded-full ${URGENCY_CONFIG.high.dot}`}
                  />
                  {highCount} High
                </Badge>
              )}
              {mediumCount > 0 && (
                <Badge
                  variant="outline"
                  className={`${URGENCY_CONFIG.medium.bg} ${URGENCY_CONFIG.medium.border} ${URGENCY_CONFIG.medium.color}`}
                >
                  <span
                    className={`mr-1.5 h-2 w-2 rounded-full ${URGENCY_CONFIG.medium.dot}`}
                  />
                  {mediumCount} Medium
                </Badge>
              )}
            </div>

            {/* Order list — show up to 5 most urgent */}
            <div className="space-y-1.5">
              {orders.slice(0, 5).map((order) => {
                const config = URGENCY_CONFIG[order.urgency];
                return (
                  <div
                    key={order.id}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 ${config.bg} border ${config.border}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`h-2 w-2 rounded-full ${config.dot} shrink-0`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {order.orderId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.buyerUsername || "Unknown buyer"} • RM
                          {order.totalAmount.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className={`text-sm font-medium ${config.color}`}>
                        {formatHoursRemaining(order.hoursRemaining)}
                      </p>
                      {order.packageNumber && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                          <Package className="h-3 w-3" />
                          {order.packageNumber}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {total > 5 && (
              <p className="text-xs text-muted-foreground text-center">
                +{total - 5} more orders near SLA deadline
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
