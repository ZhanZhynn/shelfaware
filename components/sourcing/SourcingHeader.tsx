"use client";

import Link from "next/link";
import { LogOut, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export default function SourcingHeader({ userName }: { userName: string }) {
  const queryClient = useQueryClient();
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // The local session must still be cleared if the server is unavailable.
    } finally {
      localStorage.removeItem("isAuth"); localStorage.removeItem("isLoggedIn"); localStorage.removeItem("token"); localStorage.removeItem("getSession"); localStorage.removeItem("prevUserId"); localStorage.removeItem("stock-inventory-query-cache"); queryClient.clear();
      window.location.assign("/login/sourcing");
    }
  };

  return <header className="border-b bg-background"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex items-center gap-3"><Link href="/sourcing" className="flex items-center gap-2 font-semibold"><PackageSearch className="h-5 w-5 text-sky-600" />ShelfAware Sourcing</Link><span className="hidden text-sm text-muted-foreground sm:inline">Workspace procurement</span></div><div className="flex items-center gap-2"><span className="hidden text-sm text-muted-foreground sm:inline">{userName}</span><Button variant="ghost" size="sm" onClick={logout}><LogOut className="h-4 w-4" />Sign out</Button></div></div></header>;
}
