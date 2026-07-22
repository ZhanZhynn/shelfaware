"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useSourcingWorkspaces } from "@/hooks/queries";

type Sourcer = { id: string; name: string; email: string };
type Invitation = { id: string; email: string; name: string | null; expiresAt: string };

export default function SourcingMembers() {
  const { data: workspaces = [] } = useSourcingWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const workspaceId = selectedWorkspaceId || workspaces[0]?.id || "";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [data, setData] = useState<{ members: Sourcer[]; invitations: Invitation[] }>({ members: [], invitations: [] });
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<Sourcer | null>(null);
  const [activeCases, setActiveCases] = useState(0);

  const load = () => {
    if (!workspaceId) return Promise.resolve();
    return fetch(`/api/sourcing/members?workspaceId=${workspaceId}`, { credentials: "include" }).then(async (response) => {
      if (response.ok) setData(await response.json());
    });
  };
  useEffect(() => { void load(); }, [workspaceId]);

  const request = async (url: string, options: RequestInit) => {
    const response = await fetch(url, { ...options, credentials: "include", headers: { "Content-Type": "application/json", ...options.headers } });
    const json = await response.json();
    setMessage(response.ok ? "Saved." : json.error || "Request failed.");
    if (response.ok) { setEmail(""); setName(""); await load(); }
    return { ok: response.ok, json };
  };

  const startRemoval = async (member: Sourcer) => {
    const result = await request(`/api/sourcing/members/${member.id}`, { method: "DELETE" });
    if (result.ok) return;
    if (result.json.activeCases) {
      setRemoving(member);
      setActiveCases(result.json.activeCases);
    }
  };

  const confirmRemoval = async () => {
    if (!removing) return;
    const result = await request(`/api/sourcing/members/${removing.id}?confirmUnassign=true`, { method: "DELETE" });
    if (result.ok) setRemoving(null);
  };

  return <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold">Manage sourcers</h1><p className="text-muted-foreground">Add approved accounts or send secure invitations.</p></div>
    <Card><CardContent className="grid gap-3 p-6 sm:grid-cols-3">
      <Select value={workspaceId} onValueChange={setSelectedWorkspaceId}><SelectTrigger><SelectValue placeholder="Workspace" /></SelectTrigger><SelectContent>{workspaces.map((workspace: any) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent></Select>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
      <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" />
      <Button disabled={!workspaceId || !email} onClick={() => void request("/api/sourcing/members", { method: "POST", body: JSON.stringify({ workspaceId, name, email, invite: true }) })}>Add sourcer / invite</Button>
      {message && <p className="text-sm text-muted-foreground sm:col-span-3">{message}</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Active sourcers</CardTitle></CardHeader><CardContent className="space-y-3">{data.members.length ? data.members.map((member) => <div className="flex items-center justify-between" key={member.id}><span>{member.name} <small className="text-muted-foreground">{member.email}</small></span><Button variant="outline" size="sm" onClick={() => void startRemoval(member)}>Remove</Button></div>) : <p className="text-muted-foreground">No sourcers.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader><CardContent className="space-y-3">{data.invitations.length ? data.invitations.map((invitation) => <div className="flex flex-wrap items-center justify-between gap-2" key={invitation.id}><span>{invitation.name || invitation.email} <small className="text-muted-foreground">expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void request("/api/sourcing/members", { method: "PATCH", body: JSON.stringify({ invitationId: invitation.id, action: "resend" }) })}>Resend</Button><Button variant="outline" size="sm" onClick={() => void request("/api/sourcing/members", { method: "PATCH", body: JSON.stringify({ invitationId: invitation.id, action: "revoke" }) })}>Revoke</Button></div></div>) : <p className="text-muted-foreground">No pending invitations.</p>}</CardContent></Card>
    <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Unassign active cases?</AlertDialogTitle><AlertDialogDescription>{removing?.name} has {activeCases} active sourcing case{activeCases === 1 ? "" : "s"}. Removing this sourcer will leave only those active cases unassigned. Ordered, rejected, cannot-source, and archived case history will remain assigned.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void confirmRemoval()}>Remove and unassign active cases</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
