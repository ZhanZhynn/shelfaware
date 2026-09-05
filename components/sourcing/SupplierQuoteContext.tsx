"use client";
/* eslint-disable @next/next/no-img-element -- sourcing attachments require authenticated URLs. */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SupplierContext = {
  quoteGroupId: string;
  supplierName: string;
  notes?: string | null;
  images: Array<{ id: string; url: string; fileName?: string | null }>;
};

export function SupplierQuoteContext({ contexts }: { contexts: SupplierContext[] }) {
  const [activeContext, setActiveContext] = useState<SupplierContext | null>(null);

  if (!contexts.length) return null;

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold">Supplier context</h2>
          <p className="text-sm text-muted-foreground">
            Overview of each available supplier quote sheet.
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {contexts.length} supplier{contexts.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {contexts.map((context) => {
          const hasDetails = Boolean(context.notes || context.images.length);
          return (
            <article key={context.quoteGroupId} className="rounded-md border bg-muted/20 p-3">
              <p className="font-medium">{context.supplierName}</p>
              {context.notes ? (
                <p className="mt-1 max-h-10 overflow-hidden whitespace-pre-wrap text-sm text-muted-foreground">
                  {context.notes}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {context.images.length
                    ? "Images only"
                    : "No supplier-wide details yet"}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <div className="flex -space-x-2">
                  {context.images.slice(0, 3).map((image) => (
                    <img
                      key={image.id}
                      className="h-9 w-9 rounded border-2 border-background object-cover"
                      src={image.url}
                      alt={`Supplier-wide image from ${context.supplierName}`}
                    />
                  ))}
                </div>
                {context.images.length > 3 && (
                  <span className="text-xs text-muted-foreground">
                    +{context.images.length - 3}
                  </span>
                )}
                {hasDetails ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => setActiveContext(context)}
                  >
                    View details
                  </Button>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground">
                    No details added
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <Dialog
        open={!!activeContext}
        onOpenChange={(open) => !open && setActiveContext(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{activeContext?.supplierName} supplier context</DialogTitle>
            <DialogDescription>
              Supplier-wide information for this quote sheet.
            </DialogDescription>
          </DialogHeader>
          {activeContext && (
            <div className="space-y-4">
              {activeContext.notes && (
                <div className="rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                  {activeContext.notes}
                </div>
              )}
              {activeContext.images.length > 0 && (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {activeContext.images.map((image) => (
                    <a key={image.id} href={image.url} target="_blank" rel="noreferrer">
                      <img
                        className="aspect-square w-full rounded border object-cover"
                        src={image.url}
                        alt={image.fileName || `Supplier-wide image from ${activeContext.supplierName}`}
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setActiveContext(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
