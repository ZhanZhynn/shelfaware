"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminSidebar from "./AdminSidebar";

export default function AdminMobileDrawer({
  isSuperAdmin,
}: {
  isSuperAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open admin navigation"
          className="h-8 w-8 sm:h-10 sm:w-10 text-gray-900 hover:bg-sky-500/10 dark:text-foreground dark:hover:bg-white/10"
        >
          <Menu className="h-4 w-4 sm:h-5 sm:w-5" />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-[60] flex w-[min(22rem,calc(100vw-2.5rem))] flex-col border-l border-gray-200/50 bg-white/95 shadow-2xl outline-none dark:border-white/10 dark:bg-gray-950/95 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-gray-200/50 px-4 py-3 dark:border-white/10">
            <DialogPrimitive.Title className="text-sm font-semibold">Admin navigation</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close admin navigation">
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AdminSidebar
              isSuperAdmin={isSuperAdmin}
              mobileDrawer
              onNavigate={() => setOpen(false)}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
