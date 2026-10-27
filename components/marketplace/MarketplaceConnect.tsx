"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OAuthPlatform } from "@/lib/auth/marketplace-connect";

export function MarketplaceConnect({ platform, identity, initialShop = "" }: { platform: OAuthPlatform; identity: string; initialShop?: string }) {
  const [shop, setShop] = useState(initialShop);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/${platform}/auth`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(platform === "shopify" ? { shop } : {}) });
      const data = await response.json();
      if (!response.ok || typeof data.url !== "string") throw new Error(data.error || "Unable to start authorization");
      window.location.assign(data.url);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to start authorization"); setBusy(false); }
  }
  return <main className="mx-auto max-w-lg space-y-4 p-8">
    <h1 className="text-2xl font-semibold">Connect {platform} shop</h1>
    <p>You are authorizing this connection as <strong>{identity}</strong> on this application host.</p>
    <p>Continue only if this is the intended administrator account.</p>
    {platform === "shopify" && <label className="block">Shopify domain<Input value={shop} onChange={(event) => setShop(event.target.value)} placeholder="store.myshopify.com" autoComplete="off" /></label>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button onClick={connect} disabled={busy}>{busy ? "Starting…" : "Continue to marketplace"}</Button>
  </main>;
}
