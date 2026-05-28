"use client";

/**
 * Defers Radix Select mount until the App Router route is stable (one animation frame).
 * Use on nav-heavy pages and any Select that portals to document.body, so portals
 * tear down cleanly before the next route unmounts (avoids removeChild NotFoundError).
 */

import type { ReactNode } from "react";
import { useDeferredRadixSelect } from "@/hooks/use-deferred-radix-select";

export type DeferredSelectGateRenderProps = {
  showSelect: boolean;
  selectRemountKey: string;
};

export type DeferredSelectGateProps = {
  /** When false, unmount Select (e.g. parent loading skeleton) */
  enabled?: boolean;
  /** Shown until route is stable; should match Select trigger dimensions */
  placeholder?: ReactNode;
  children: (ctx: DeferredSelectGateRenderProps) => ReactNode;
};

export function DeferredSelectGate({
  enabled = true,
  placeholder = null,
  children,
}: DeferredSelectGateProps) {
  const { showSelect, selectRemountKey } = useDeferredRadixSelect({ enabled });

  if (!showSelect) {
    return placeholder;
  }

  return <>{children({ showSelect, selectRemountKey })}</>;
}
