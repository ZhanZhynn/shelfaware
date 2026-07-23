"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UnknownCurrencyReconciliation } from "@/lib/server/financial-currency";

export function CurrencyReconciliation() {
  const { data, isLoading } = useQuery({
    queryKey: ["financials", "currency-reconciliation"],
    queryFn: async () => {
      const response = await fetch("/api/financials/currency-reconciliation");
      if (!response.ok) throw new Error("Unable to load currency reconciliation");
      return response.json() as Promise<UnknownCurrencyReconciliation>;
    },
  });

  if (isLoading || !data || data.totalRecords === 0) return null;

  return (
    <Card className="border-amber-300/70 bg-amber-50/50 dark:bg-amber-950/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Unknown Currency Reconciliation
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {data.totalRecords} marketplace record{data.totalRecords === 1 ? "" : "s"} excluded from MYR aggregates because the upstream currency was not stored.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">Reference</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((record) => (
                <tr key={`${record.source}:${record.recordId}`} className="border-b last:border-0">
                  <td className="py-2">{record.source}</td>
                  <td className="py-2 font-mono text-xs">{record.reference}</td>
                  <td className="py-2">{record.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (currency unknown)</td>
                  <td className="py-2">{record.occurredAt ? new Date(record.occurredAt).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.truncated && <p className="mt-3 text-xs text-muted-foreground">Showing the newest {data.records.length} records.</p>}
      </CardContent>
    </Card>
  );
}
