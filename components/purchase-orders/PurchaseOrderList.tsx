"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePurchaseOrders, useDeletePurchaseOrder, useApprovePurchaseOrder } from "@/hooks/queries/use-purchase-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Eye, Trash2, Check, X, ClipboardList } from "lucide-react";
import type { PurchaseOrder } from "@/types/purchase-order";
import { formatMoney } from "@/lib/money";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/15 text-gray-700",
  pending_approval: "bg-amber-500/15 text-amber-700",
  approved: "bg-emerald-500/15 text-emerald-700",
  rejected: "bg-red-500/15 text-red-700",
  ordered: "bg-blue-500/15 text-blue-700",
  shipped: "bg-violet-500/15 text-violet-700",
  received: "bg-violet-500/15 text-violet-700",
  cancelled: "bg-gray-500/15 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  ordered: "Ordered",
  shipped: "Shipped",
  received: "Received",
  cancelled: "Cancelled",
};

export default function PurchaseOrderList() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: orders, isLoading } = usePurchaseOrders(
    statusFilter !== "all" ? { status: statusFilter } : undefined,
  );
  const deleteMutation = useDeletePurchaseOrder();
  const approveMutation = useApprovePurchaseOrder();

  if (isLoading || !orders) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-[80px] rounded-[20px]" />)}
      </div>
    );
  }

  const filtered = orders.filter((o: PurchaseOrder) => {
    const searchMatch = !search || (o.poNumber as string).toLowerCase().includes(search.toLowerCase()) || (o.supplierName as string)?.toLowerCase().includes(search.toLowerCase());
    return searchMatch;
  });

  const stats = {
    draft: orders.filter((o: PurchaseOrder) => o.status === "draft").length,
    pendingApproval: orders.filter((o: PurchaseOrder) => o.status === "pending_approval").length,
    approved: orders.filter((o: PurchaseOrder) => o.status === "approved").length,
     totalValue: orders.reduce((s: number, o: PurchaseOrder) => s + (o.currency === "MYR" || !o.currency ? o.totalAmount : (o.convertedTotalMyr || 0)), 0),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <p className="text-muted-foreground">Manage procurement and supplier orders</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Draft</p>
            <p className="text-2xl font-bold">{stats.draft}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pending Approval</p>
            <p className="text-2xl font-bold text-amber-600">{stats.pendingApproval}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Approved</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.approved}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Value</p>
             <p className="text-2xl font-bold">{formatMoney(stats.totalValue, "MYR")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-sm w-[200px]" />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="ordered">Ordered</option>
          <option value="shipped">Shipped</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
            <CardContent className="p-8 text-center">
              <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No purchase orders found</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((order: PurchaseOrder) => (
            <Card key={order.id as string} className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{order.poNumber as string}</p>
                        <Badge className={STATUS_COLORS[order.status as string] || ""}>
                          {STATUS_LABELS[order.status as string] || order.status as string}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {order.supplierName as string} · {(order.items as unknown[])?.length ?? 0} items · {new Date(order.createdAt as string).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-bold">{formatMoney(order.totalAmount, order.currency || "MYR")}</p>
                    {order.convertedTotalMyr != null && order.currency !== "MYR" && <p className="text-xs text-muted-foreground">≈ {formatMoney(order.convertedTotalMyr, "MYR")}</p>}
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="View" asChild>
                        <Link href={`/admin/purchase-orders/${order.id}`}><Eye className="h-4 w-4" /></Link>
                      </Button>
                      {order.status === "pending_approval" && (
                        <>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" title="Approve"
                            onClick={() => approveMutation.mutate({ id: order.id as string, action: "approve" })}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" title="Reject"
                            onClick={() => approveMutation.mutate({ id: order.id as string, action: "reject" })}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {["draft", "pending_approval"].includes(order.status as string) && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" title="Cancel"
                          onClick={() => deleteMutation.mutate(order.id as string)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
