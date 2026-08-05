"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useIsRestoring } from "@tanstack/react-query";
import {
  useDeleteSourcingCase,
  useSourcingCases,
  useSourcingCommand,
  useSourcingWorkspaces,
} from "@/hooks/queries";
import { useShipPurchaseOrder } from "@/hooks/queries/use-purchase-orders";
import {
  getSourcingGroup,
  getSourcingStageBadgeVariant,
  getSourcingStatusMessage,
  type SourcingPresentationGroup,
  type SourcingViewer,
} from "@/lib/sourcing/presentation";
import { SourcingSlaSettings } from "./SourcingSlaSettings";
import { SourcingCostSettings } from "./SourcingCostSettings";

const stageLabel = (stage: string) => stage.replaceAll("_", " ");

const GROUP_META: Record<
  SourcingPresentationGroup,
  {
    label: string;
    badge: "warning" | "info" | "success" | "destructive" | "secondary";
    accent: string;
    activeFilter: string;
    inactiveFilter: string;
  }
> = {
  needs_action: {
    label: "Needs Action",
    badge: "warning",
    accent: "border-l-orange-500",
    activeFilter: "border-orange-500 bg-orange-500 text-white",
    inactiveFilter:
      "border-orange-300 bg-transparent text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950",
  },
  waiting: {
    label: "Waiting",
    badge: "info",
    accent: "border-l-blue-500",
    activeFilter: "border-blue-500 bg-blue-500 text-white",
    inactiveFilter:
      "border-blue-300 bg-transparent text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950",
  },
  to_ship: {
    label: "To Ship",
    badge: "info",
    accent: "border-l-blue-500",
    activeFilter: "border-blue-500 bg-blue-500 text-white",
    inactiveFilter:
      "border-blue-300 bg-transparent text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950",
  },
  shipped: {
    label: "Shipped",
    badge: "success",
    accent: "border-l-emerald-500",
    activeFilter: "border-emerald-500 bg-emerald-500 text-white",
    inactiveFilter:
      "border-emerald-300 bg-transparent text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950",
  },
  completed: {
    label: "Completed",
    badge: "success",
    accent: "border-l-emerald-500",
    activeFilter: "border-emerald-500 bg-emerald-500 text-white",
    inactiveFilter:
      "border-emerald-300 bg-transparent text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950",
  },
  closed: {
    label: "Closed",
    badge: "secondary",
    accent: "border-l-slate-400",
    activeFilter: "border-slate-500 bg-slate-500 text-white",
    inactiveFilter:
      "border-slate-300 bg-transparent text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-950",
  },
};

export default function SourcingPortal({
  basePath = "/sourcing",
  manageMembers = false,
}: {
  basePath?: string;
  manageMembers?: boolean;
}) {
  const isRestoring = useIsRestoring();
  const {
    data: workspaces = [],
    isLoading: loadingWorkspaces,
    error: workspaceError,
  } = useSourcingWorkspaces();
  const [workspaceId, setWorkspaceId] = useState("");
  const activeWorkspace = workspaceId || workspaces[0]?.id || "";
  const {
    data: cases = [],
    isLoading,
    error,
  } = useSourcingCases(activeWorkspace);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<SourcingPresentationGroup | "all">("all");
  const [pendingAction, setPendingAction] = useState<{
    type: "cancel" | "delete";
    item: any;
  } | null>(null);
  const [pendingShipment, setPendingShipment] = useState<{
    purchaseOrderId: string;
    title: string;
  } | null>(null);
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const command = useSourcingCommand();
  const deleteCase = useDeleteSourcingCase();
  const shipPurchaseOrder = useShipPurchaseOrder();
  const isAdminView = basePath.startsWith("/admin");
  const viewer: SourcingViewer = isAdminView ? "admin" : "sourcer";
  const filterGroups: SourcingPresentationGroup[] = isAdminView
    ? ["needs_action", "waiting", "completed", "closed"]
    : ["needs_action", "waiting", "to_ship", "shipped", "completed"];
  const groupOf = (stage: string) => getSourcingGroup(stage, viewer);

  const counts = cases.reduce(
    (acc: Record<string, number>, item: any) => {
      const g = groupOf(item.stage);
      acc[g] = (acc[g] || 0) + 1;
      acc.all = (acc.all || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const filtered = cases.filter((item: any) => {
    const matchesGroup =
      groupFilter === "all" || groupOf(item.stage) === groupFilter;
    const matchesSearch = item.title
      .toLowerCase()
      .includes(search.toLowerCase());
    return matchesGroup && matchesSearch;
  });

  const canAssign =
    workspaces.find((w: any) => w.id === activeWorkspace)?.canAssign ?? false;

  if (isRestoring || loadingWorkspaces)
    return (
      <main className="mx-auto max-w-5xl p-6">
        <div className="h-36 animate-pulse rounded-xl bg-muted" />
      </main>
    );
  if (workspaceError)
    return (
      <main className="p-6 text-destructive">
        Unable to load sourcing workspaces.
      </main>
    );

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sourcing</h1>
          <p className="text-muted-foreground">
            Source products, compare supplier quotes, and hand off approved
            orders.
          </p>
        </div>
        <div className="flex gap-2">
          {manageMembers && (
            <Button variant="outline" asChild>
              <Link href={`${basePath}/members`}>Manage sourcers</Link>
            </Button>
          )}
          {canAssign && (
            <Button asChild>
              <Link
                href={
                  activeWorkspace
                    ? `${basePath}/new?workspaceId=${activeWorkspace}`
                    : `${basePath}/new`
                }
              >
                <Plus /> New case
              </Link>
            </Button>
          )}
        </div>
      </div>
      {!workspaces.length ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            You are not a member of a sourcing workspace.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={activeWorkspace} onValueChange={setWorkspaceId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((workspace: { id: string; name: string }) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search cases"
              />
            </div>
            {canAssign && (
              <div className="flex gap-1">
                <SourcingSlaSettings
                  key={activeWorkspace}
                  workspaceId={activeWorkspace}
                  members={[]}
                />
                <SourcingCostSettings
                  key={`cost-${activeWorkspace}`}
                  workspaceId={activeWorkspace}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {(["all", ...filterGroups] as const).map((key) => {
              const isActive = groupFilter === key;
              const meta = key === "all" ? null : GROUP_META[key];
              const count = counts[key] || 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setGroupFilter(key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? meta
                        ? meta.activeFilter
                        : "border-foreground bg-foreground/10 text-foreground"
                      : meta
                        ? meta.inactiveFilter
                        : "border-transparent bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {key === "all" ? "All" : meta!.label}
                  <span
                    className={`rounded-full px-1.5 text-xs ${isActive ? "bg-background/50" : "bg-muted-foreground/15"}`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {error ? (
            <Card>
              <CardContent className="p-6 text-destructive">
                Unable to load sourcing cases.
              </CardContent>
            </Card>
          ) : isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((key) => (
                <div
                  key={key}
                  className="h-20 animate-pulse rounded-xl bg-muted"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No cases found.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((item: any) => {
                const group = groupOf(item.stage);
                const meta = GROUP_META[group];
                const isDue =
                  item.slaDueAt || item.nextActionAt
                    ? new Date(item.slaDueAt || item.nextActionAt) < new Date()
                    : false;
                const canCancel =
                  isAdminView &&
                  ![
                    "cancelled",
                    "ordered",
                    "shipping",
                    "received",
                    "rejected",
                    "cannot_source",
                    "archived",
                  ].includes(item.stage);
                const canDelete =
                  isAdminView &&
                  ["draft", "cancelled"].includes(item.stage) &&
                  !item.orders?.length;
                const canOrder = isAdminView && item.stage === "approved";
                const purchaseOrderId = item.orders?.[0]?.purchaseOrderId;
                const canShip = !isAdminView && item.stage === "ordered" && !!purchaseOrderId;
                const statusMessage = getSourcingStatusMessage(
                  item.stage,
                  viewer,
                  item.assignee?.name || item.assignee?.email,
                );
                return (
                  <div
                    key={item.id}
                    className={`relative rounded-lg border border-l-4 ${meta.accent} bg-card p-4 transition-colors hover:bg-muted/50`}
                  >
                    <Link
                      href={`${basePath}/${item.id}`}
                      className={`block ${canOrder || canShip || canCancel || canDelete ? "pr-28 sm:pr-36" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        {item.thumbnail && (
                          <>
                            {/* The file endpoint requires the browser session cookie. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.thumbnail.url}
                              alt={item.thumbnail.fileName || "Case reference"}
                              className="h-14 w-14 shrink-0 rounded-md border object-cover"
                            />
                          </>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold truncate">
                              {item.title}
                            </h3>
                            <Badge variant={getSourcingStageBadgeVariant(item.stage)} className="shrink-0">
                              {stageLabel(item.stage)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {item.assignee?.name ||
                              item.assignee?.email ||
                              "Unassigned"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-muted-foreground">
                            {item.updatedAt
                              ? new Date(item.updatedAt).toLocaleDateString()
                              : new Date(item.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      {(statusMessage || item.nextAction || isDue) && (
                        <p
                          className={`mt-2 text-sm ${isDue ? "font-medium text-destructive" : "text-muted-foreground"}`}
                        >
                          {statusMessage || "Follow up"}
                          {item.nextAction && (
                            <span className="ml-1 text-muted-foreground">
                              · {item.nextAction}
                            </span>
                          )}
                          {(item.slaDueAt || item.nextActionAt) && (
                            <span className="ml-1">
                              ·{" "}
                              {new Date(
                                item.slaDueAt || item.nextActionAt,
                              ).toLocaleDateString()}
                              {isDue ? " (overdue)" : ""}
                            </span>
                          )}
                        </p>
                      )}
                    </Link>
                    {(canOrder || canShip || canCancel || canDelete) && (
                      <div className="absolute right-3 top-3 flex gap-1">
                        {canOrder && (
                          <Button
                            size="sm"
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={() =>
                              command.mutate({
                                id: item.id,
                                version: item.version,
                                action: "confirm_order",
                              })
                            }
                          >
                            Confirm order
                          </Button>
                        )}
                        {canShip && (
                          <Button
                            size="sm"
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={() => {
                              setTrackingCarrier("");
                              setTrackingNumber("");
                              setPendingShipment({ purchaseOrderId, title: item.title });
                            }}
                          >
                            Ship
                          </Button>
                        )}
                        {canCancel && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPendingAction({ type: "cancel", item })
                            }
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Cancel
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              setPendingAction({ type: "delete", item })
                            }
                            aria-label={`Delete ${item.title}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <Dialog
        open={!!pendingShipment}
        onOpenChange={(open) => !open && setPendingShipment(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {pendingShipment?.title || "order"} as shipped</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm font-medium">
              Carrier (optional)
              <Input
                value={trackingCarrier}
                onChange={(event) => setTrackingCarrier(event.target.value)}
                placeholder="e.g. DHL, SF Express"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Tracking number (optional)
              <Input
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="Add it now or update it later"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingShipment(null)}
              disabled={shipPurchaseOrder.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              isLoading={shipPurchaseOrder.isPending}
              onClick={async () => {
                if (!pendingShipment) return;
                await shipPurchaseOrder.mutateAsync({
                  id: pendingShipment.purchaseOrderId,
                  trackingCarrier: trackingCarrier.trim() || undefined,
                  trackingNumber: trackingNumber.trim() || undefined,
                });
                setPendingShipment(null);
              }}
            >
              Mark as shipped
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!pendingAction}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.type === "delete"
                ? "Delete sourcing request?"
                : "Cancel sourcing request?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.type === "delete"
                ? "This permanently deletes a draft or cancelled request that has no purchase order."
                : "This stops sourcing work, clears pending follow-ups, and moves the request to Cancelled."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep request</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingAction) return;
                if (pendingAction.type === "delete") {
                  deleteCase.mutate(
                    { id: pendingAction.item.id },
                    { onSuccess: () => setPendingAction(null) },
                  );
                } else {
                  command.mutate(
                    {
                      id: pendingAction.item.id,
                      version: pendingAction.item.version,
                      action: "cancel",
                    },
                    { onSuccess: () => setPendingAction(null) },
                  );
                }
              }}
            >
              {pendingAction?.type === "delete"
                ? "Delete request"
                : "Cancel request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
