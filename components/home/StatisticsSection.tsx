/**
 * Statistics Section Component
 * Displays store-wide (self + client + supplier + other users) stats cards
 * matching admin dashboard-overall-insights. Uses dashboard API only.
 */

"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Package,
  FolderTree,
  Truck,
  DollarSign,
  ShoppingCart,
  FileText,
  Warehouse,
  ShoppingBag,
  Store,
} from "lucide-react";
import { StatisticsCard } from "./StatisticsCard";
import { StatisticsCardSkeleton } from "./StatisticsCardSkeleton";
import { useDashboard } from "@/hooks/queries/use-dashboard";

const formatCurrency = (value: number) =>
  `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * StatisticsSection — 8 cards in same order and format as admin dashboard-overall-insights.
 * Store-wide data (self + client + supplier + other users). Skeleton on dashboard load only.
 */
export function StatisticsSection() {
  const isMountedRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  const dashboardQuery = useDashboard();
  const stats = dashboardQuery.data ?? null;

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      queueMicrotask(() => setIsMounted(true));
    }
  }, []);

  const isLoading = !isMounted || dashboardQuery.isPending;
  const revenueFromOrders =
    stats?.orderAnalytics?.totalRevenueExcludingCancelled ??
    stats?.revenue?.fromOrders ??
    0;
  const selfOthers = stats?.selfOthersBreakdown;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
      {isLoading ? (
        <>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <StatisticsCardSkeleton key={i} />
          ))}
        </>
      ) : stats ? (
        <>
          <StatisticsCard
            title="Total Products"
            value={stats.counts?.products ?? 0}
            description="Products availability"
            icon={Package}
            variant="rose"
            badges={[
              { label: "Available", value: stats.productStatusBreakdown?.available ?? 0 },
              { label: "Stock low", value: stats.productStatusBreakdown?.stockLow ?? 0 },
              { label: "Stock out", value: stats.productStatusBreakdown?.stockOut ?? 0 },
            ]}
          />
          <StatisticsCard
            title="Total Value"
            value={formatCurrency(stats.totalInventoryValue ?? 0)}
            description="Total inventory value"
            icon={DollarSign}
            variant="violet"
            badges={[
              {
                label: "Orders",
                value: formatCurrency(
                  stats.orderAnalytics?.totalRevenueExcludingCancelled ??
                    stats.revenue?.fromOrders ??
                    0,
                ),
              },
              { label: "Invoices", value: formatCurrency(stats.revenue?.fromInvoices ?? 0) },
              {
                label: "Due",
                value: formatCurrency(stats.invoiceAnalytics?.outstandingAmount ?? 0),
              },
              {
                label: "Cancelled",
                value: formatCurrency(stats.orderAnalytics?.cancelledOrderAmount ?? 0),
              },
            ]}
          />
          <StatisticsCard
            title="Total Revenue"
            value={formatCurrency(revenueFromOrders)}
            description="Profits (excl. cancelled)"
            icon={DollarSign}
            variant="emerald"
            badges={[
              {
                label: "Paid",
                value: formatCurrency(stats.orderAnalytics?.paidOrderAmount ?? 0),
              },
              {
                label: "Due",
                value: formatCurrency(stats.invoiceAnalytics?.outstandingAmount ?? 0),
              },
              {
                label: "Refund",
                value: formatCurrency(stats.orderAnalytics?.refundedAmount ?? 0),
              },
              {
                label: "Pending",
                value: formatCurrency(stats.orderAnalytics?.pendingOrderAmount ?? 0),
              },
              ...(selfOthers
                ? [
                    { label: "Self", value: formatCurrency(selfOthers.revenueSelf) },
                    { label: "Others", value: formatCurrency(selfOthers.revenueOthers) },
                  ]
                : []),
            ]}
          />
          <StatisticsCard
            title="Total Orders"
            value={stats.counts?.orders}
            description="Total orders placed (self + client)"
            icon={ShoppingCart}
            variant="blue"
            badges={[
              {
                label: "Pending",
                value: stats.orderAnalytics?.statusDistribution?.pending ?? 0,
              },
              {
                label: "Confirmed",
                value: stats.orderAnalytics?.statusDistribution?.confirmed ?? 0,
              },
              {
                label: "Shipping",
                value:
                  (stats.orderAnalytics?.statusDistribution?.processing ?? 0) +
                  (stats.orderAnalytics?.statusDistribution?.shipped ?? 0),
              },
              { label: "Refund", value: stats.orderAnalytics?.refundedCount ?? 0 },
              {
                label: "Cancel",
                value: stats.orderAnalytics?.statusDistribution?.cancelled ?? 0,
              },
              ...(selfOthers
                ? [
                    { label: "Self", value: selfOthers.orderSelfCount },
                    { label: "Others", value: selfOthers.orderOthersCount },
                  ]
                : []),
            ]}
          />
          <StatisticsCard
            title="Invoices"
            value={stats.counts?.invoices}
            description="Total invoices (store-wide)"
            icon={FileText}
            variant="sky"
            badges={[
              {
                label: "Paid",
                value: stats.invoiceAnalytics?.statusDistribution?.paid ?? 0,
              },
              {
                label: "Pending",
                value:
                  (stats.invoiceAnalytics?.statusDistribution?.draft ?? 0) +
                  (stats.invoiceAnalytics?.statusDistribution?.sent ?? 0),
              },
              {
                label: "Overdue",
                value: stats.invoiceAnalytics?.statusDistribution?.overdue ?? 0,
              },
              {
                label: "Cancelled",
                value: stats.invoiceAnalytics?.statusDistribution?.cancelled ?? 0,
              },
              { label: "Refunded", value: stats.orderAnalytics?.refundedCount ?? 0 },
              ...(selfOthers
                ? [
                    { label: "Self", value: selfOthers.invoiceSelfCount },
                    { label: "Others", value: selfOthers.invoiceOthersCount },
                  ]
                : []),
            ]}
          />
          {stats.shopeeOrderAnalytics && (
            <StatisticsCard
              title="Shopee Orders"
              value={stats.shopeeOrderAnalytics.totalOrders}
              description={`Revenue: ${formatCurrency(stats.shopeeOrderAnalytics.totalRevenue)}`}
              icon={ShoppingBag}
              variant="orange"
              badges={[
                {
                  label: "Unpaid",
                  value: stats.shopeeOrderAnalytics.ordersByStatus?.UNPAID ?? 0,
                },
                {
                  label: "To Ship",
                  value: stats.shopeeOrderAnalytics.ordersByStatus?.READY_TO_SHIP ?? 0,
                },
                {
                  label: "Shipped",
                  value: stats.shopeeOrderAnalytics.ordersByStatus?.SHIPPED ?? 0,
                },
                {
                  label: "Completed",
                  value: stats.shopeeOrderAnalytics.ordersByStatus?.COMPLETED ?? 0,
                },
                {
                  label: "Cancelled",
                  value: stats.shopeeOrderAnalytics.ordersByStatus?.CANCELLED ?? 0,
                },
                ...(stats.shopeeOrderAnalytics.nearSlaCount > 0
                  ? [{ label: "Near SLA", value: stats.shopeeOrderAnalytics.nearSlaCount }]
                  : []),
              ]}
            />
          )}
          {stats.lazadaOrderAnalytics && (
            <StatisticsCard
              title="Lazada Orders"
              value={stats.lazadaOrderAnalytics.totalOrders}
              description={`Revenue: ${formatCurrency(stats.lazadaOrderAnalytics.totalRevenue)}`}
              icon={Store}
              variant="blue"
              badges={[
                {
                  label: "Pending",
                  value: stats.lazadaOrderAnalytics.ordersByStatus?.pending ?? 0,
                },
                {
                  label: "Processing",
                  value: stats.lazadaOrderAnalytics.ordersByStatus?.processing ?? 0,
                },
                {
                  label: "Shipped",
                  value: stats.lazadaOrderAnalytics.ordersByStatus?.shipped ?? 0,
                },
                {
                  label: "Delivered",
                  value: stats.lazadaOrderAnalytics.ordersByStatus?.delivered ?? 0,
                },
                {
                  label: "Cancelled",
                  value: stats.lazadaOrderAnalytics.ordersByStatus?.cancelled ?? 0,
                },
              ]}
            />
          )}
          <StatisticsCard
            title="Total Warehouses"
            value={stats.counts?.warehouses}
            description="Storage locations"
            icon={Warehouse}
            variant="teal"
            badges={[
              { label: "Active", value: stats.warehouseAnalytics?.activeWarehouses ?? 0 },
              { label: "Inactive", value: stats.warehouseAnalytics?.inactiveWarehouses ?? 0 },
            ]}
          />
          <StatisticsCard
            title="Total Suppliers"
            value={stats.counts?.suppliers}
            description="Suppliers"
            icon={Truck}
            variant="emerald"
            badges={[
              { label: "Active", value: stats.supplierStatusBreakdown?.active ?? 0 },
              { label: "Inactive", value: stats.supplierStatusBreakdown?.inactive ?? 0 },
            ]}
          />
          <StatisticsCard
            title="Categories"
            value={stats.counts?.categories}
            description="Product categories"
            icon={FolderTree}
            variant="amber"
            badges={[
              { label: "Active", value: stats.categoryStatusBreakdown?.active ?? 0 },
              { label: "Inactive", value: stats.categoryStatusBreakdown?.inactive ?? 0 },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}
