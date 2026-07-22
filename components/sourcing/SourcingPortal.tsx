"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsRestoring } from "@tanstack/react-query";
import { useSourcingCases, useSourcingWorkspaces } from "@/hooks/queries";

const stageLabel = (stage: string) => stage.replaceAll("_", " ");
export default function SourcingPortal({ basePath = "/sourcing", manageMembers = false }: { basePath?: string; manageMembers?: boolean }) {
  const isRestoring = useIsRestoring();
  const { data: workspaces = [], isLoading: loadingWorkspaces, error: workspaceError } = useSourcingWorkspaces();
  const [workspaceId, setWorkspaceId] = useState(""); const activeWorkspace = workspaceId || workspaces[0]?.id || "";
  const { data: cases = [], isLoading, error } = useSourcingCases(activeWorkspace);
  const [search, setSearch] = useState(""); const [stage, setStage] = useState("all");
  const filtered = cases.filter((item: { title: string; stage: string }) => (stage === "all" || item.stage === stage) && item.title.toLowerCase().includes(search.toLowerCase()));
  // Persisted query restoration can synchronously replace an SSR-empty cache. Keep the shell stable until it finishes.
  if (isRestoring || loadingWorkspaces) return <main className="mx-auto max-w-6xl p-6"><div className="h-36 animate-pulse rounded-xl bg-muted" /></main>;
  if (workspaceError) return <main className="p-6 text-destructive">Unable to load sourcing workspaces.</main>;
  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">Sourcing</h1><p className="text-muted-foreground">Source products, compare supplier quotes, and hand off approved orders.</p></div><div className="flex gap-2">{manageMembers && <Button variant="outline" asChild><Link href={`${basePath}/members`}>Manage sourcers</Link></Button>}<Button asChild><Link href={activeWorkspace ? `${basePath}/new?workspaceId=${activeWorkspace}` : `${basePath}/new`}><Plus /> New sourcing case</Link></Button></div></div>
    {!workspaces.length ? <Card><CardContent className="p-6 text-muted-foreground">You are not a member of a sourcing workspace.</CardContent></Card> : <><div className="grid gap-3 sm:grid-cols-3"><Select value={activeWorkspace} onValueChange={setWorkspaceId}><SelectTrigger><SelectValue placeholder="Workspace" /></SelectTrigger><SelectContent>{workspaces.map((workspace: { id: string; name: string }) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent></Select><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requests" /></div><Select value={stage} onValueChange={setStage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All stages</SelectItem>{["draft", "sourcing", "changes_requested", "quoted", "approved", "ordered", "rejected", "cannot_source", "archived"].map((value) => <SelectItem key={value} value={value}>{stageLabel(value)}</SelectItem>)}</SelectContent></Select></div>
    {error ? <Card><CardContent className="p-6 text-destructive">Unable to load sourcing cases.</CardContent></Card> : isLoading ? <div className="space-y-3">{[1, 2, 3].map((key) => <div key={key} className="h-20 animate-pulse rounded-xl bg-muted" />)}</div> : !filtered.length ? <Card><CardContent className="p-8 text-center text-muted-foreground">No sourcing cases match these filters.</CardContent></Card> : <div className="overflow-hidden rounded-xl border"><div className="hidden grid-cols-[2fr_repeat(5,1fr)] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase text-muted-foreground md:grid"><span>Request</span><span>Stage</span><span>Route</span><span>Assignee</span><span>Latest quote</span><span>Updated</span></div>{filtered.map((item: any) => { const quote = item.quotes?.[0]; return <Link key={item.id} href={`${basePath}/${item.id}`} className="grid gap-2 border-b px-4 py-4 last:border-0 hover:bg-muted/40 md:grid-cols-[2fr_repeat(5,1fr)]"><strong>{item.title}</strong><span className="capitalize text-sm">{stageLabel(item.stage)}</span><span className="capitalize text-sm">{item.route || "yiwu"}</span><span className="text-sm text-muted-foreground">{item.assignee?.name || item.assignee?.email || "Unassigned"}</span><span className="text-sm text-muted-foreground">{quote ? `r${quote.revision} ${quote.status}` : "No quote"}</span><span className="text-sm text-muted-foreground">{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : new Date(item.createdAt).toLocaleDateString()}</span></Link>; })}</div>}</>}</main>;
}
