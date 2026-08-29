"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, MoreHorizontal, Plus, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsRestoring } from "@tanstack/react-query";
import {
  useDeleteSourcingCase,
  useSourcingCases,
  useSourcingCommand,
  useSupplierOrders,
  useSourcingWorkspaces,
} from "@/hooks/queries";
import {
  getSourcingGroup,
  getSourcingStageBadgeVariant,
  getSourcingStatusMessage,
  type SourcingPresentationGroup,
  type SourcingViewer,
} from "@/lib/sourcing/presentation";
import { SourcingSlaSettings } from "./SourcingSlaSettings";
import { SourcingCostSettings } from "./SourcingCostSettings";
import { SourcingWorkQueue } from "./SourcingWorkQueue";
import { SourcingRequestHeader } from "./SourcingRequestRow";
import { SourcingRequestQueue } from "./SourcingRequestQueue";

const stageLabel = (stage: string) => stage.replaceAll("_", " ");

const SOURCER_TRACKING_GROUP_LABELS: Partial<
  Record<SourcingPresentationGroup, string>
> = {
  needs_action: "Needs Sourcing",
  waiting: "Waiting",
  to_ship: "In Fulfillment",
  completed: "Completed",
};

const stageFilterOrder = [
  "draft",
  "sourcing",
  "changes_requested",
  "quoted",
  "approved",
  "order_pending",
  "ordered",
  "shipping",
  "received",
  "cancelled",
];

const variantLabel = (variant: any) =>
  variant.customLabel ||
  [variant.size, variant.material, variant.colour]
    .filter(Boolean)
    .join(" / ") ||
  "Standard";

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
  changes_requested: {
    label: "Changes requested",
    badge: "warning",
    accent: "border-l-amber-500",
    activeFilter: "border-amber-500 bg-amber-500 text-white",
    inactiveFilter:
      "border-amber-300 bg-transparent text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950",
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
    badge: "info",
    accent: "border-l-blue-500",
    activeFilter: "border-blue-500 bg-blue-500 text-white",
    inactiveFilter:
      "border-blue-300 bg-transparent text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950",
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

const ADMIN_GROUP_LABELS: Partial<Record<SourcingPresentationGroup, string>> = {
  needs_action: "Needs action",
  changes_requested: "Changes requested",
  waiting: "Sourcing",
  shipped: "Ordering",
  completed: "Completed",
  closed: "Closed",
};

const adminActionLabel = (stage: string) => {
  if (stage === "draft") return "Finish request";
  if (stage === "quoted") return "Review offers";
  if (stage === "approved") return "Review order";
  return "View progress";
};

export default function SourcingPortal({
  basePath = "/sourcing",
  manageMembers = false,
}: {
  basePath?: string;
  manageMembers?: boolean;
}) {
  const isRestoring = useIsRestoring();
  const router = useRouter();
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
  const { data: supplierOrders = [] } = useSupplierOrders(activeWorkspace);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"work" | "requests">("work");
  const [groupFilter, setGroupFilter] = useState<
    SourcingPresentationGroup | "all"
  >("needs_action");
  const [stageFilter, setStageFilter] = useState("all");
  const [pendingAction, setPendingAction] = useState<{
    type: "cancel" | "delete";
    item: any;
  } | null>(null);
  const command = useSourcingCommand();
  const deleteCase = useDeleteSourcingCase();
  const isAdminView = basePath.startsWith("/admin");
  const viewer: SourcingViewer = isAdminView ? "admin" : "sourcer";
  const filterGroups: SourcingPresentationGroup[] = isAdminView
    ? [
      "needs_action",
      "changes_requested",
      "waiting",
      "shipped",
      "completed",
      // "closed",
    ]
    : ["needs_action", "waiting", "to_ship", "completed"];
  const groupOf = (stage: string) => {
    if (isAdminView) return getSourcingGroup(stage, viewer);
    if (["draft", "sourcing", "changes_requested"].includes(stage)) return "needs_action";
    if (stage === "quoted") return "waiting";
    if (["approved", "order_pending", "ordered", "shipping"].includes(stage)) return "to_ship";
    if (stage === "received") return "completed";
    return "closed";
  };
  const stageOf = (item: any) =>
    item.stage === "quoted" &&
      item.quotes?.some((quote: any) => quote.status === "changes_requested")
      ? "changes_requested"
      : item.stage;

  const counts = cases.reduce(
    (acc: Record<string, number>, item: any) => {
      const g = groupOf(stageOf(item));
      acc[g] = (acc[g] || 0) + 1;
      acc.all = (acc.all || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const groupCases = cases.filter(
    (item: any) =>
      groupFilter === "all" || groupOf(stageOf(item)) === groupFilter,
  );
  const stageCounts = groupCases.reduce(
    (acc: Record<string, number>, item: any) => {
      const stage = stageOf(item);
      acc[stage] = (acc[stage] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const availableStageFilters = stageFilterOrder.filter(
    (stage) => stageCounts[stage],
  );

  const filtered = cases.filter((item: any) => {
    const matchesGroup =
      groupFilter === "all" || groupOf(stageOf(item)) === groupFilter;
    const matchesStage =
      stageFilter === "all" || stageOf(item) === stageFilter;
    const query = search.toLowerCase();
    const matchesSearch =
      !query ||
      item.title.toLowerCase().includes(query) ||
      item.id.toLowerCase().includes(query) ||
      `${item.requester?.name || ""} ${item.requester?.email || ""}`
        .toLowerCase()
        .includes(query) ||
      `${item.assignee?.name || ""} ${item.assignee?.email || ""}`
        .toLowerCase()
        .includes(query);
    return matchesGroup && matchesStage && matchesSearch;
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
            Request products, review supplier offers, and follow each order.
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
                <Plus /> Request a product
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
          </div>
          {!isAdminView && (
            <div className="flex gap-7 border-b">
              <button type="button" onClick={() => setView("work")} className={`border-b-2 px-1 pb-3 text-sm font-medium ${view === "work" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>My Work <span className="ml-1">{supplierOrders.filter((order: any) => ["approved", "ordered"].includes(order.status)).length + cases.filter((item: any) => ["sourcing", "changes_requested"].includes(item.stage)).length}</span></button>
              <button type="button" onClick={() => setView("requests")} className={`border-b-2 px-1 pb-3 text-sm font-medium ${view === "requests" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>Requests <span className="ml-1">{cases.length}</span></button>
            </div>
          )}

          {view === "work" && !isAdminView ? (
            <SourcingWorkQueue
              workspaceId={activeWorkspace}
              basePath={basePath}
              cases={cases}
              supplierOrders={supplierOrders}
            />
          ) : !isAdminView ? (
            <SourcingRequestQueue cases={cases} basePath={basePath} mode="tracking" />
          ) : <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b">
              <h2 className="text-lg font-semibold">Requests</h2>
              <div className="ml-auto flex flex-wrap gap-x-6">
                {(["all", ...filterGroups] as const).map((key) => {
                  const isActive = groupFilter === key;
                  const meta = key === "all" ? null : GROUP_META[key];
                  const count = counts[key] || 0;
                  return (
                    <button
                      key={key}
                      type="button"
                  onClick={() => {
                    setGroupFilter(key);
                    setStageFilter("all");
                  }}
                      className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${isActive
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      {key === "all"
                        ? "All"
                        : isAdminView
                          ? ADMIN_GROUP_LABELS[key] || meta!.label
                          : (SOURCER_TRACKING_GROUP_LABELS[key] || meta!.label)}
                      <span className="ml-1">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
              <span className="mr-1 font-medium text-muted-foreground">
                Request status
              </span>
              {(["all", ...availableStageFilters] as const).map((stage) => {
                const active = stageFilter === stage;
                const count =
                  stage === "all" ? groupCases.length : stageCounts[stage] || 0;
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setStageFilter(stage)}
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      active
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    {stage === "all" ? "All" : stageLabel(stage)} ({count})
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center border-b pb-3">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="ml-auto min-w-[260px] max-w-md"
                placeholder="Title, requester, assignee, or request ID"
              />
            </div>

            <div className="grid grid-cols-[minmax(260px,1fr)_140px_130px_110px] gap-3 bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
              <span>Request</span>
              <span>Assigned to</span>
              <span>Status</span>
              <span>Actions</span>
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
                  const stage = stageOf(item);
                  const group = groupOf(stage);
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
                  const poStatuses = (item.orders || [])
                    .map((order: any) => order.purchaseOrder?.status)
                    .filter(Boolean);
                  const poTotal = poStatuses.length;
                  const poShipped = poStatuses.filter((status: string) =>
                    ["shipping", "received"].includes(status),
                  ).length;
                  const shipProgress =
                    poTotal > 1 &&
                    ["ordered", "shipping"].includes(item.stage)
                      ? `${poShipped}/${poTotal} shipped`
                      : null;
                  const poSummary = Object.entries(
                    poStatuses.reduce((acc: Record<string, number>, status: string) => {
                      acc[status] = (acc[status] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>),
                  )
                    .map(([status, count]) => `${count} ${status === "approved" ? "To Order" : status === "ordered" ? "To Ship" : status}`)
                    .join(" · ");
                  const statusMessage = getSourcingStatusMessage(
                    stage,
                    viewer,
                    item.assignee?.name || item.assignee?.email,
                  );
                  return (
                    <div
                      key={item.id}
                      className={`cursor-pointer overflow-hidden rounded-md border border-l-4 ${meta.accent} bg-card transition-colors hover:bg-muted/40`}
                      role="link"
                      tabIndex={0}
                      onClick={() => router.push(`${basePath}/${item.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`${basePath}/${item.id}`);
                        }
                      }}
                    >
                      <SourcingRequestHeader item={item} />
                      <div className="grid grid-cols-[minmax(260px,1fr)_140px_130px_110px] gap-3 p-3">
                        <div className="flex min-w-0 items-start gap-3">
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
                                <Link
                                  href={`${basePath}/${item.id}`}
                                  className="hover:text-sky-600 hover:underline"
                                >
                                  {item.title}
                                </Link>
                              </h3>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {item.updatedAt
                                ? new Date(item.updatedAt).toLocaleDateString()
                                : new Date(item.createdAt).toLocaleDateString()}
                              {statusMessage && <span className={isDue ? "font-medium text-destructive" : "text-muted-foreground"}> · {statusMessage}</span>}
                            </p>
                            {!isAdminView && poTotal > 0 && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {poTotal} PO{poTotal === 1 ? "" : "s"} · {poSummary}
                              </p>
                            )}
                            {isAdminView &&
                              !item.orders?.length &&
                              item.variants?.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                  {item.variants
                                    .filter(
                                      (variant: any) =>
                                        variant.requestQuote !== false &&
                                        variant.origin === "admin",
                                    )
                                    .slice(0, 4)
                                    .map((variant: any) => (
                                      <span
                                        key={variant.id}
                                        className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                                        title={`${variantLabel(variant)} · ${variant.requestedQuantity} units`}
                                      >
                                        {variantLabel(variant)} ·{" "}
                                        {variant.requestedQuantity}
                                      </span>
                                    ))}
                                  {item.variants.filter(
                                    (variant: any) =>
                                      variant.requestQuote !== false &&
                                      variant.origin === "admin",
                                  ).length > 4 && (
                                    <span className="px-1 text-xs text-muted-foreground">
                                      +
                                      {item.variants.filter(
                                        (variant: any) =>
                                          variant.requestQuote !== false &&
                                          variant.origin === "admin",
                                      ).length - 4}{" "}
                                      more
                                    </span>
                                  )}
                                </div>
                              )}
                          </div>
                        </div>
                        <div className="pt-1 text-sm text-muted-foreground">{item.assignee?.name || item.assignee?.email || "Unassigned"}</div>
                        <div className="pt-1"><Badge variant={getSourcingStageBadgeVariant(stage)} className="capitalize">{stageLabel(stage)}</Badge>{shipProgress && <p className="mt-1 text-xs text-muted-foreground">{shipProgress}</p>}</div>
                        <div
                          className="flex flex-col items-start gap-1"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          {/* <Button size="sm" variant="link" className="h-auto px-0" asChild> */}
                          {/*   <Link href={`${basePath}/${item.id}`}> */}
                          {/*     {isAdminView */}
                          {/*       ? adminActionLabel(stage) */}
                          {/*       : "Open request"} */}
                           {/*   </Link> */}
                           {/* </Button> */}
                             {!isAdminView && (
                               <Link
                                 href={`${basePath}/${item.id}`}
                                 className="py-2 text-sm text-sky-600 hover:underline"
                               >
                                 View request
                               </Link>
                             )}
                          {(canCancel || canDelete) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost">
                                  <MoreHorizontal className="h-4 w-4" />
                                  More
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canCancel && (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      setPendingAction({ type: "cancel", item })
                                    }
                                  >
                                    <Ban className="h-4 w-4" />
                                    Cancel request
                                  </DropdownMenuItem>
                                )}
                                {canDelete && (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() =>
                                      setPendingAction({ type: "delete", item })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Delete request
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                    </div>
                    </div>
                  );
                })}
              </div>
            )}
            {canAssign && (
              <details className="rounded-lg border bg-card px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Workspace settings
                </summary>
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
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
              </details>
            )}
          </div>}
        </>
      )}
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
