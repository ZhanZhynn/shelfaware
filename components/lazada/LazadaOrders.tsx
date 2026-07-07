"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingCart, ArrowLeft, Package } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  confirmed: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  processing: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  shipped: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  delivered: "bg-green-500/15 text-green-700 dark:text-green-400",
  cancelled: "bg-red-500/15 text-red-700 dark:text-red-400",
  returned: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

export default function LazadaOrders() {
  const searchParams = useSearchParams();
  const sellerIdParam = searchParams.get("sellerId") || undefined;

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["lazada", "orders", sellerIdParam, page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (sellerIdParam) params.set("sellerId", sellerIdParam);
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/lazada/orders?${params}`);
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/lazada">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Lazada Orders</h1>
          <p className="text-muted-foreground">
            {data ? `${data.total} orders` : "Loading..."}
          </p>
        </div>
      </div>

      {/* Status Filter */}
      <div className="flex gap-2 flex-wrap">
        {["", "pending", "confirmed", "processing", "shipped", "delivered", "cancelled"].map(
          (status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setStatusFilter(status);
                setPage(1);
              }}
            >
              {status || "All"}
            </Button>
          ),
        )}
      </div>

      {/* Order List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : data?.orders?.length > 0 ? (
        <div className="space-y-4">
          {data.orders.map((order: { id: string; lazadaOrderId: string; orderNumber: string | null; orderStatus: string; totalAmount: number; customerFirstName: string | null; lazadaCreatedAt: string | null; items: Array<{ productName: string; quantity: number; price: number }> }) => (
            <Card key={order.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium">
                      Order #{order.orderNumber || order.lazadaOrderId}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {order.customerFirstName || "Customer"} |{" "}
                      {order.lazadaCreatedAt
                        ? new Date(order.lazadaCreatedAt).toLocaleDateString()
                        : "N/A"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-medium">RM {order.totalAmount.toFixed(2)}</p>
                    <Badge
                      className={STATUS_COLORS[order.orderStatus] || ""}
                      variant="secondary"
                    >
                      {order.orderStatus}
                    </Badge>
                  </div>
                </div>
                {order.items?.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    {order.items.length} item{order.items.length > 1 ? "s" : ""}:{" "}
                    {order.items
                      .slice(0, 3)
                      .map((i) => i.productName)
                      .join(", ")}
                    {order.items.length > 3 && ` +${order.items.length - 3} more`}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <span className="flex items-center px-3 text-sm text-muted-foreground">
                Page {page} of {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ShoppingCart className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Orders Found</h3>
            <p className="text-muted-foreground text-center">
              {statusFilter
                ? `No orders with status "${statusFilter}"`
                : "Sync your Lazada seller to see orders here"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
