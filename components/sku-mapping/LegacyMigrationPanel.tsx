"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Button } from "@/components/ui/button";

type MigrationCandidate = {
  legacyMappingId: string;
  wmsProductId: string;
  wmsProductSku: string;
  wmsProductName: string;
  channel: string;
  channelProductId: string;
  channelType: string;
  platform: "shopee";
  shopId: string;
  externalProductId: string;
  externalVariantId: string | null;
  offerKey: string;
  offerKind: "variant" | "verified-product";
  normalizedSku: string;
  proposedSalesSkuId: string | null;
  proposedSalesSkuCode: string | null;
  confidence: string;
  ambiguous: boolean;
  ambiguityReason: string | null;
  alreadyMapped: boolean;
};

type MigrationSummary = {
  totalLegacyRows: number;
  proposedCandidates: number;
  ambiguousRows: number;
  skippedRows: number;
  alreadyMappedRows: number;
  noSkuMatchRows: number;
};

type MigrationData = {
  candidates: MigrationCandidate[];
  summary: MigrationSummary;
};

export function LegacyMigrationPanel({
  skus,
}: {
  skus: { id: string; code: string; name: string }[];
}) {
  const client = useQueryClient();
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [selectedSkuIds, setSelectedSkuIds] = useState<Map<string, string>>(new Map());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const migration = useQuery({
    queryKey: ["skuMapping", "migration"],
    queryFn: async () =>
      (
        await axios.get("/api/inventory/sku-mapping/migration", {
          withCredentials: true,
        })
      ).data as MigrationData,
  });

  const confirmCommand = useMutation({
    mutationFn: async (data: {
      platform: "shopee";
      shopId: string;
      externalProductId: string;
      externalVariantId?: string;
      offerKind: "variant" | "verified-product";
      salesSkuId: string;
      effectiveFrom: string;
    }) =>
      axios.post(
        "/api/inventory/sku-mapping",
        { command: "confirm-mapping", data },
        { withCredentials: true },
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["skuMapping"] });
    },
  });

  if (migration.isLoading)
    return <div className="h-32 animate-pulse rounded bg-muted" />;

  if (!migration.data)
    return (
      <p className="text-destructive">Could not load migration candidates.</p>
    );

  const { candidates, summary } = migration.data;

  const actionable = candidates.filter(
    (c) => c.proposedSalesSkuId && !c.ambiguous && !c.alreadyMapped,
  );

  const candidateKey = (c: MigrationCandidate) =>
    `${c.legacyMappingId}:${c.offerKey}`;

  const handleApprove = (candidate: MigrationCandidate) => {
    const key = candidateKey(candidate);
    const salesSkuId =
      selectedSkuIds.get(key) ?? candidate.proposedSalesSkuId;
    if (!salesSkuId) return;
    setApprovedIds((prev) => new Set(prev).add(candidate.legacyMappingId));
    confirmCommand.mutate({
      platform: "shopee",
      shopId: candidate.shopId,
      externalProductId: candidate.externalProductId,
      externalVariantId: candidate.externalVariantId ?? undefined,
      offerKind: candidate.offerKind,
      salesSkuId,
      effectiveFrom: new Date().toISOString(),
    });
  };

  const handleReject = (candidate: MigrationCandidate) => {
    setRejectedIds((prev) => new Set(prev).add(candidate.legacyMappingId));
  };

  const handleBulkApprove = () => {
    setBulkConfirmOpen(false);
    for (const candidate of actionable) {
      if (
        !approvedIds.has(candidate.legacyMappingId) &&
        !rejectedIds.has(candidate.legacyMappingId)
      ) {
        handleApprove(candidate);
      }
    }
  };

  const bulkSkuPreview = actionable
    .filter(
      (c) =>
        !approvedIds.has(c.legacyMappingId) &&
        !rejectedIds.has(c.legacyMappingId),
    )
    .map((c) => {
      const key = candidateKey(c);
      const skuCode =
        skus.find((s) => s.id === (selectedSkuIds.get(key) ?? c.proposedSalesSkuId))
          ?.code ?? c.proposedSalesSkuCode ?? "none";
      return `${c.offerKey} → ${skuCode}`;
    });

  const visibleCandidates = candidates.filter(
    (c) => !rejectedIds.has(c.legacyMappingId),
  );

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold">Legacy migration</h2>
        <p className="text-sm text-muted-foreground">
          Proposed candidates from legacy ProductChannelMapping rows. Review and
          approve to create shared MarketplaceSkuMapping entries.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded bg-muted p-3 text-sm md:grid-cols-3">
        <div>
          <span className="text-muted-foreground">Total legacy rows:</span>{" "}
          <strong>{summary.totalLegacyRows}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">Proposed candidates:</span>{" "}
          <strong>{summary.proposedCandidates}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">Already mapped:</span>{" "}
          <strong>{summary.alreadyMappedRows}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">Ambiguous:</span>{" "}
          <strong>{summary.ambiguousRows}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">No SKU match:</span>{" "}
          <strong>{summary.noSkuMatchRows}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">Skipped:</span>{" "}
          <strong>{summary.skippedRows}</strong>
        </div>
      </div>

      {actionable.length > 0 && !bulkConfirmOpen && (
        <Button
          onClick={() => setBulkConfirmOpen(true)}
          disabled={confirmCommand.isPending}
        >
          Approve all non-ambiguous ({actionable.length})
        </Button>
      )}
      {bulkConfirmOpen && (
        <div className="space-y-2 rounded border p-3 text-sm">
          <p className="font-medium">
            Confirm bulk approve {actionable.length} candidates:
          </p>
          <ul className="max-h-40 space-y-1 overflow-auto text-muted-foreground">
            {bulkSkuPreview.map((line) => (
              <li key={line}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleBulkApprove}
              disabled={confirmCommand.isPending}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkConfirmOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {visibleCandidates.map((candidate) => {
          const isApproved = approvedIds.has(candidate.legacyMappingId);
          return (
            <div
              key={`${candidate.legacyMappingId}:${candidate.offerKey}`}
              className="flex flex-wrap items-center gap-2 rounded bg-muted p-2 text-sm"
            >
              <code>{candidate.offerKey}</code>
              <span className="text-muted-foreground">→</span>
              {candidate.proposedSalesSkuCode ? (
                <strong>{candidate.proposedSalesSkuCode}</strong>
              ) : (
                <span className="italic text-muted-foreground">no SKU match</span>
              )}
              <span className="rounded bg-background px-1.5 py-0.5 text-xs">
                {candidate.confidence}
              </span>
              {candidate.ambiguous && (
                <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-800">
                  ambiguous
                </span>
              )}
              {candidate.alreadyMapped && (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
                  already mapped
                </span>
              )}
              {isApproved && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                  approved
                </span>
              )}
              {!candidate.alreadyMapped && !isApproved && (
                <div className="flex gap-1">
                  <select
                    className="rounded border bg-background p-1"
                    value={selectedSkuIds.get(candidateKey(candidate)) ?? candidate.proposedSalesSkuId ?? ""}
                    onChange={(e) => {
                      const key = candidateKey(candidate);
                      setSelectedSkuIds((prev) => {
                        const next = new Map(prev);
                        next.set(key, e.target.value);
                        return next;
                      });
                    }}
                  >
                    <option value="">Select Sales SKU</option>
                    {skus.map((sku) => (
                      <option key={sku.id} value={sku.id}>
                        {sku.code}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={
                      !(selectedSkuIds.get(candidateKey(candidate)) ?? candidate.proposedSalesSkuId) ||
                      candidate.ambiguous ||
                      confirmCommand.isPending
                    }
                    onClick={() => handleApprove(candidate)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReject(candidate)}
                  >
                    Reject
                  </Button>
                </div>
              )}
              {candidate.ambiguityReason && (
                <p className="w-full text-xs text-muted-foreground">
                  {candidate.ambiguityReason}
                </p>
              )}
            </div>
          );
        })}
        {!candidates.length && (
          <p className="text-sm text-muted-foreground">
            No legacy ProductChannelMapping rows found.
          </p>
        )}
      </div>
      {confirmCommand.error && (
        <p className="text-sm text-destructive">
          {confirmCommand.error instanceof Error
            ? confirmCommand.error.message
            : "Could not confirm migration candidate."}
        </p>
      )}
    </section>
  );
}
