"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History, ArrowLeft, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import Link from "next/link";

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string }> = {
  completed: { icon: CheckCircle, color: "text-green-500" },
  completed_with_errors: { icon: AlertTriangle, color: "text-yellow-500" },
  failed: { icon: XCircle, color: "text-red-500" },
  running: { icon: Clock, color: "text-blue-500" },
};

export default function LazadaSyncHistory() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ["lazada", "sync-logs"],
    queryFn: async () => {
      const res = await fetch("/api/lazada/shops");
      if (!res.ok) return [];
      const shops = await res.json();
      if (!shops.length) return [];

      // Fetch sync logs for the first seller
      const logsRes = await fetch(`/api/shopee/sync/logs`); // Reuse for now
      if (!logsRes.ok) return [];
      return logsRes.json();
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
          <h1 className="text-2xl font-bold">Lazada Sync History</h1>
          <p className="text-muted-foreground">View recent synchronization logs</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : logs && logs.length > 0 ? (
        <div className="space-y-4">
          {logs.map((log: { id: string; syncType: string; status: string; itemsSynced: number; itemsCreated: number; itemsUpdated: number; errors: string[] | null; startedAt: string; completedAt: string | null; triggeredBy: string }) => {
            const config = STATUS_CONFIG[log.status] || STATUS_CONFIG.running || { icon: Clock, color: "text-gray-500" };
            const Icon = config.icon;

            return (
              <Card key={log.id}>
                <CardContent className="flex items-center gap-4 py-4">
                  <Icon className={`h-5 w-5 ${config.color}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium capitalize">{log.syncType} sync</p>
                      <Badge variant="outline">{log.status}</Badge>
                      <Badge variant="secondary">{log.triggeredBy}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {new Date(log.startedAt).toLocaleString()}
                      {log.completedAt &&
                        ` — ${new Date(log.completedAt).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p>
                      <span className="text-muted-foreground">Synced:</span>{" "}
                      {log.itemsSynced}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Created:</span>{" "}
                      {log.itemsCreated} |{" "}
                      <span className="text-muted-foreground">Updated:</span>{" "}
                      {log.itemsUpdated}
                    </p>
                    {log.errors && log.errors.length > 0 && (
                      <p className="text-red-500 text-xs">
                        {log.errors.length} error{log.errors.length > 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <History className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Sync History</h3>
            <p className="text-muted-foreground text-center">
              Sync your Lazada seller to see history here
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
