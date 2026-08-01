"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useSourcingCases, useSourcingWorkspaces } from "@/hooks/queries";
import { SourcingSlaSettings } from "./SourcingSlaSettings";
import { SourcingCostSettings } from "./SourcingCostSettings";

const stageLabel = (stage: string) => stage.replaceAll("_", " ");

type CaseGroup = "needs_action" | "submitted" | "completed" | "rejected" | "archived";

const GROUP_META: Record<CaseGroup, { label: string; badge: "warning" | "info" | "success" | "destructive" | "secondary"; accent: string; activeFilter: string; inactiveFilter: string }> = {
  needs_action: { label: "Needs Action", badge: "warning", accent: "border-l-orange-500", activeFilter: "border-orange-500 bg-orange-500 text-white", inactiveFilter: "border-orange-300 bg-transparent text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950" },
  submitted:    { label: "Submitted",    badge: "info",     accent: "border-l-blue-500",   activeFilter: "border-blue-500 bg-blue-500 text-white", inactiveFilter: "border-blue-300 bg-transparent text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950" },
  completed:    { label: "Completed",    badge: "success",  accent: "border-l-emerald-500", activeFilter: "border-emerald-500 bg-emerald-500 text-white", inactiveFilter: "border-emerald-300 bg-transparent text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950" },
  rejected:     { label: "Rejected",     badge: "destructive", accent: "border-l-red-500",  activeFilter: "border-red-500 bg-red-500 text-white", inactiveFilter: "border-red-300 bg-transparent text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950" },
  archived:     { label: "Archived",     badge: "secondary", accent: "border-l-gray-400",   activeFilter: "border-gray-400 bg-gray-400 text-white", inactiveFilter: "border-gray-300 bg-transparent text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-900" },
};

const STAGE_TO_GROUP: Record<string, CaseGroup> = {
  draft: "needs_action",
  sourcing: "needs_action",
  changes_requested: "needs_action",
  quoted: "submitted",
  approved: "completed",
  ordered: "completed",
  shipped: "completed",
  received: "completed",
  rejected: "rejected",
  cannot_source: "rejected",
  archived: "archived",
};

const groupOf = (stage: string): CaseGroup => STAGE_TO_GROUP[stage] ?? "needs_action";

export default function SourcingPortal({
  basePath = "/sourcing",
  manageMembers = false,
}: {
  basePath?: string;
  manageMembers?: boolean;
}) {
  const isRestoring = useIsRestoring();
  const { data: workspaces = [], isLoading: loadingWorkspaces, error: workspaceError } = useSourcingWorkspaces();
  const [workspaceId, setWorkspaceId] = useState("");
  const activeWorkspace = workspaceId || workspaces[0]?.id || "";
  const { data: cases = [], isLoading, error } = useSourcingCases(activeWorkspace);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<CaseGroup | "all">("all");

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
    const matchesGroup = groupFilter === "all" || groupOf(item.stage) === groupFilter;
    const matchesSearch = item.title.toLowerCase().includes(search.toLowerCase());
    return matchesGroup && matchesSearch;
  });

  const canAssign = workspaces.find((w: any) => w.id === activeWorkspace)?.canAssign ?? false;

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
            Source products, compare supplier quotes, and hand off approved orders.
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
              <Link href={activeWorkspace ? `${basePath}/new?workspaceId=${activeWorkspace}` : `${basePath}/new`}>
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
                <SourcingSlaSettings key={activeWorkspace} workspaceId={activeWorkspace} members={[]} />
                <SourcingCostSettings key={`cost-${activeWorkspace}`} workspaceId={activeWorkspace} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {(["all", "needs_action", "submitted", "completed", "rejected", "archived"] as const).map((key) => {
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
                  <span className={`rounded-full px-1.5 text-xs ${isActive ? "bg-background/50" : "bg-muted-foreground/15"}`}>
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
                <div key={key} className="h-20 animate-pulse rounded-xl bg-muted" />
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
                return (
                  <Link
                    key={item.id}
                    href={`${basePath}/${item.id}`}
                    className={`block rounded-lg border border-l-4 ${meta.accent} bg-card p-4 transition-colors hover:bg-muted/50`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold truncate">{item.title}</h3>
                          <Badge variant={meta.badge} className="shrink-0">
                            {stageLabel(item.stage)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.assignee?.name || item.assignee?.email || "Unassigned"}
                          <span className="mx-1.5">·</span>
                          <span className="capitalize">{item.route || "yiwu"}</span>
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">
                          {item.updatedAt
                            ? new Date(item.updatedAt).toLocaleDateString()
                            : new Date(item.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {(item.nextAction || isDue) && (
                      <p className={`mt-2 text-sm ${isDue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                        {item.nextAction || "Follow up"}
                        {(item.slaDueAt || item.nextActionAt) && (
                          <span className="ml-1">
                            · {new Date(item.slaDueAt || item.nextActionAt).toLocaleDateString()}
                            {isDue ? " (overdue)" : ""}
                          </span>
                        )}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
