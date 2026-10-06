"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const scopes = [
  { value: "marketplace:read", label: "Read marketplace data", description: "Local catalog, shops, analytics, and sync status." },
  { value: "marketplace:live", label: "Read live marketplace data", description: "Direct, read-only provider requests." },
  { value: "marketplace:sync", label: "Queue marketplace syncs", description: "Creates durable synchronization jobs." },
  { value: "marketplace:finance", label: "Financial data", description: "Reserved for finance-enabled integrations." },
  { value: "marketplace:pii", label: "Personally identifiable information", description: "Reserved for PII-enabled integrations." },
] as const;

type Scope = (typeof scopes)[number]["value"];
type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function displayDate(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

function responseMessage(body: unknown, fallback: string) {
  return typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

export default function ApiTokenSettings() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Scope[]>(["marketplace:read"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/api-tokens", { credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(body, "Unable to load API tokens."));
      setTokens(Array.isArray(body?.tokens) ? body.tokens : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load API tokens.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const toggleScope = (scope: Scope, checked: boolean) => {
    setSelectedScopes((current) => checked ? [...new Set([...current, scope])] : current.filter((value) => value !== scope));
  };

  const createToken = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setCreatedToken(null);
    if (!name.trim() || selectedScopes.length === 0) {
      setError("Enter a token name and select at least one scope.");
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/api-tokens", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes: selectedScopes,
          ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(body, "Unable to create API token."));
      setCreatedToken(typeof body?.token === "string" ? body.token : null);
      setName("");
      setExpiresAt("");
      await loadTokens();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create API token.");
    } finally {
      setCreating(false);
    }
  };

  const revokeToken = async (token: ApiToken) => {
    if (!window.confirm(`Revoke ${token.name}? Any integration using this token will immediately lose access.`)) return;
    setError(null);
    setRevokingId(token.id);
    try {
      const response = await fetch(`/api/api-tokens/${token.id}`, { method: "DELETE", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(body, "Unable to revoke API token."));
      await loadTokens();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke API token.");
    } finally {
      setRevokingId(null);
    }
  };

  const copyCreatedToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("Copy failed. Select and copy the token manually.");
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-sky-600" />
            <h1 className="text-2xl font-bold tracking-tight">API Tokens</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Create and revoke scoped tokens for Marketplace v1 integrations.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadTokens()} isLoading={loading}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {createdToken && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">Copy this token now</CardTitle>
            <CardDescription>For security, this secret is shown only once. Store it in your integration&apos;s secret manager.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <code className="min-w-0 flex-1 break-all rounded-md bg-muted p-3 text-sm">{createdToken}</code>
            <Button type="button" variant="outline" onClick={() => void copyCreatedToken()}>
              {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create a token</CardTitle>
          <CardDescription>Tokens authenticate with <code>Authorization: Bearer swa_...</code>. Grant only the scopes your integration needs.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={createToken}>
            <div className="max-w-lg space-y-2">
              <Label htmlFor="token-name">Token name</Label>
              <Input id="token-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Reporting integration" maxLength={100} required />
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Scopes</legend>
              <div className="grid gap-3 md:grid-cols-2">
                {scopes.map((scope) => (
                  <label key={scope.value} className="flex cursor-pointer gap-3 rounded-md border p-3 hover:bg-muted/50">
                    <Checkbox checked={selectedScopes.includes(scope.value)} onCheckedChange={(checked) => toggleScope(scope.value, checked === true)} aria-label={scope.label} />
                    <span>
                      <span className="block text-sm font-medium">{scope.label}</span>
                      <span className="block text-xs text-muted-foreground">{scope.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="max-w-lg space-y-2">
              <Label htmlFor="token-expiry">Expiration (optional)</Label>
              <Input id="token-expiry" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </div>
            <Button type="submit" isLoading={creating}>Create token</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your tokens</CardTitle>
          <CardDescription>Only token prefixes are retained and displayed.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Loading tokens…</p> : tokens.length === 0 ? <p className="text-sm text-muted-foreground">No API tokens yet.</p> : (
            <div className="space-y-3">
              {tokens.map((token) => {
                const expired = token.expiresAt !== null && new Date(token.expiresAt) <= new Date();
                const inactive = Boolean(token.revokedAt) || expired;
                return (
                  <div key={token.id} className="flex flex-col gap-3 rounded-md border p-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{token.name}</span>{inactive && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{token.revokedAt ? "Revoked" : "Expired"}</span>}</div>
                      <code className="text-xs text-muted-foreground">{token.prefix}…</code>
                      <p className="text-xs text-muted-foreground">Created {displayDate(token.createdAt)} · Last used {displayDate(token.lastUsedAt)} · Expires {displayDate(token.expiresAt)}</p>
                      <div className="flex flex-wrap gap-1">{token.scopes.map((scope) => <span key={scope} className="rounded bg-muted px-1.5 py-0.5 text-xs">{scope}</span>)}</div>
                    </div>
                    {!inactive && <Button variant="destructive" size="sm" isLoading={revokingId === token.id} onClick={() => void revokeToken(token)}><Trash2 /> Revoke</Button>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
