"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CrossChannelPerformance from "./CrossChannelPerformance";
import { MappingImpactPreview } from "./MappingImpactPreview";
import { CsvMappingImport } from "./CsvMappingImport";
import { LegacyMigrationPanel } from "./LegacyMigrationPanel";

type MappingInput = {
  platform: "shopee";
  shopId: string;
  externalProductId: string;
  externalVariantId?: string;
  offerKind: "variant" | "verified-product";
  salesSkuId: string;
  effectiveFrom: string;
  candidateId?: string;
};
type Preview = {
  affectedLines: number;
  affectedUnits: number;
  nativeRevenueByCurrency: Record<
    string,
    { minorUnits: string; scale: number }
  >;
  dateRange: { from: string; to: string } | null;
  overlapWarning: string | null;
  unverifiableLegacyLines: number;
  exclusionWarning: string;
};
type Inbox = {
  families: {
    id: string;
    code: string;
    name: string;
    salesSkus: { id: string; code: string; name: string }[];
  }[];
  products: { id: string; sku: string; name: string }[];
  recipes: {
    id: string;
    name: string;
    salesSku: { code: string };
    effectiveFrom: string;
    effectiveTo: string | null;
    components: { quantity: number; product: { sku: string; name: string } }[];
  }[];
  mappings: {
    id: string;
    shopId: string;
    offerKey: string;
    externalProductId: string;
    externalVariantId: string | null;
    offerKind: "variant" | "verified-product";
    effectiveFrom: string;
    effectiveTo: string | null;
    salesSku: { code: string; name: string; family: { name: string } };
    events: { eventType: string; occurredAt: string }[];
  }[];
  candidates: {
    id?: string;
    shopId: string;
    offerKey: string;
    normalizedSku: string;
    proposedSalesSkuId?: string | null;
    confidence: string;
  }[];
};
const today = () => new Date().toISOString().slice(0, 10);
const isoDate = (date: string) =>
  new Date(`${date}T00:00:00.000Z`).toISOString();

export default function SkuMappingInbox({
  canMutate = false,
}: {
  canMutate?: boolean;
}) {
  const client = useQueryClient();
  const [activeTab, setActiveTab] = useState<"inbox" | "migration">("inbox");
  const [filter, setFilter] = useState("");
  const [familyCode, setFamilyCode] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [skuName, setSkuName] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [shopId, setShopId] = useState("");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [mappingSkuId, setMappingSkuId] = useState("");
  const [mappingDate, setMappingDate] = useState(today());
  const [candidateSalesSkuIds, setCandidateSalesSkuIds] = useState<
    Record<string, string>
  >({});
  const [candidateDates, setCandidateDates] = useState<Record<string, string>>(
    {},
  );
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<Record<string, string>>({});
  const [correctionId, setCorrectionId] = useState("");
  const [correctionSkuId, setCorrectionSkuId] = useState("");
  const [correctionDate, setCorrectionDate] = useState(today());
  const query = useQuery({
    queryKey: ["skuMapping", "inbox"],
    queryFn: async () =>
      (await axios.get("/api/inventory/sku-mapping", { withCredentials: true }))
        .data as Inbox,
  });
  const command = useMutation({
    mutationFn: async ({ command, data }: { command: string; data: unknown }) =>
      axios.post("/api/inventory/sku-mapping", { command, data }),
    onSuccess: () => {
      setPreviews({});
      client.invalidateQueries({ queryKey: ["skuMapping"] });
    },
  });
  if (query.isLoading)
    return <div className="h-64 animate-pulse rounded bg-muted" />;
  if (!query.data)
    return <p className="text-destructive">Could not load shared mappings.</p>;
  const data = query.data;
  const skus = data.families.flatMap((family) => family.salesSkus);
  const matches = (value: string) =>
    value.toLowerCase().includes(filter.toLowerCase());
  const preview = async (
    key: string,
    input: MappingInput,
    excludeMappingId?: string,
  ) => {
    setPreviewing(key);
    setPreviewError((current) => ({ ...current, [key]: "" }));
    setPreviews((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      const result = await axios.post(
        "/api/inventory/sku-mapping",
        { command: "preview-mapping", data: { ...input, excludeMappingId } },
        { withCredentials: true },
      );
      setPreviews((current) => ({ ...current, [key]: result.data }));
    } catch (error) {
      setPreviewError((current) => ({
        ...current,
        [key]: axios.isAxiosError(error)
          ? (error.response?.data?.error ??
            "Could not load the historical impact preview.")
          : "Could not load the historical impact preview.",
      }));
    } finally {
      setPreviewing(null);
    }
  };
  const clearPreview = (key: string) =>
    setPreviews((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  const canConfirm = (key: string) =>
    Boolean(
      previews[key] && !previews[key].overlapWarning && !command.isPending,
    );
  const manualInput = (): MappingInput => ({
    platform: "shopee",
    shopId,
    externalProductId: productId,
    externalVariantId: variantId,
    offerKind: "variant",
    salesSkuId: mappingSkuId,
    effectiveFrom: isoDate(mappingDate),
  });
  const correction = data.mappings.find(
    (mapping) => mapping.id === correctionId,
  );
  const correctionInput =
    correction && correctionSkuId
      ? {
          platform: "shopee" as const,
          shopId: correction.shopId,
          externalProductId: correction.externalProductId,
          externalVariantId: correction.externalVariantId ?? undefined,
          offerKind: correction.offerKind,
          salesSkuId: correctionSkuId,
          effectiveFrom: isoDate(correctionDate),
        }
      : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">SKU Mapping</h1>
          <p className="text-muted-foreground">
            Shared analytics attribution only. It never changes WMS stock.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/inventory/product-performance">
            Product Performance
          </Link>
        </Button>
      </div>
      <CrossChannelPerformance />
      <div className="flex gap-2 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === "inbox"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("inbox")}
        >
          Mapping inbox
        </button>
        {canMutate && (
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "migration"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("migration")}
          >
            Legacy migration
          </button>
        )}
      </div>
      {activeTab === "migration" && canMutate && (
        <LegacyMigrationPanel skus={skus} />
      )}
      {activeTab === "inbox" && (
      <>
      <Input
        className="max-w-sm"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter offer, SKU, or family"
      />
      {canMutate && (
        <>
          <CsvMappingImport />
          <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-2">
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                command.mutate({
                  command: "create-family",
                  data: { code: familyCode, name: familyName },
                });
              }}
            >
              <h2 className="font-semibold">Product family</h2>
              <Input
                required
                value={familyCode}
                onChange={(e) => setFamilyCode(e.target.value)}
                placeholder="Global family code"
              />
              <Input
                required
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder="Family name"
              />
              <Button disabled={command.isPending}>Create family</Button>
            </form>
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                command.mutate({
                  command: "create-sales-sku",
                  data: { code: skuCode, name: skuName, familyId },
                });
              }}
            >
              <h2 className="font-semibold">Sales SKU</h2>
              <select
                required
                className="w-full rounded border bg-background p-2"
                value={familyId}
                onChange={(e) => setFamilyId(e.target.value)}
              >
                <option value="">Select family</option>
                {data.families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} - {f.name}
                  </option>
                ))}
              </select>
              <Input
                required
                value={skuCode}
                onChange={(e) => setSkuCode(e.target.value)}
                placeholder="Global Sales SKU code"
              />
              <Input
                required
                value={skuName}
                onChange={(e) => setSkuName(e.target.value)}
                placeholder="Sales SKU name"
              />
              <Button disabled={command.isPending}>Create Sales SKU</Button>
            </form>
            <form
              className="space-y-2 md:col-span-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (canConfirm("manual"))
                  command.mutate({
                    command: "confirm-mapping",
                    data: manualInput(),
                  });
              }}
            >
              <h2 className="font-semibold">Manual offer link</h2>
              <p className="text-sm text-muted-foreground">
                Preview the historical impact before confirming this verified
                offer link.
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  required
                  value={shopId}
                  onChange={(e) => {
                    setShopId(e.target.value);
                    clearPreview("manual");
                  }}
                  placeholder="Shop ID"
                />
                <Input
                  required
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    clearPreview("manual");
                  }}
                  placeholder="Shopee item ID"
                />
                <Input
                  required
                  value={variantId}
                  onChange={(e) => {
                    setVariantId(e.target.value);
                    clearPreview("manual");
                  }}
                  placeholder="Shopee model ID"
                />
                <select
                  required
                  className="rounded border bg-background p-2"
                  value={mappingSkuId}
                  onChange={(e) => {
                    setMappingSkuId(e.target.value);
                    clearPreview("manual");
                  }}
                >
                  <option value="">Select Sales SKU</option>
                  {skus.map((sku) => (
                    <option key={sku.id} value={sku.id}>
                      {sku.code}
                    </option>
                  ))}
                </select>
                <Input
                  required
                  type="date"
                  value={mappingDate}
                  onChange={(e) => {
                    setMappingDate(e.target.value);
                    clearPreview("manual");
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !shopId ||
                    !productId ||
                    !variantId ||
                    !mappingSkuId ||
                    !mappingDate ||
                    previewing === "manual"
                  }
                  onClick={() => preview("manual", manualInput())}
                >
                  {previewing === "manual"
                    ? "Loading preview..."
                    : "Preview impact"}
                </Button>
                <Button disabled={!canConfirm("manual")}>
                  Confirm mapping
                </Button>
              </div>
              {previews.manual && (
                <MappingImpactPreview preview={previews.manual} />
              )}
              {previewError.manual && (
                <p className="text-sm text-destructive">
                  {previewError.manual}
                </p>
              )}
            </form>
            <form
              className="space-y-2 md:col-span-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (correctionInput && canConfirm("correction"))
                  command.mutate({
                    command: "correct-mapping",
                    data: {
                      mappingId: correctionId,
                      salesSkuId: correctionSkuId,
                      effectiveFrom: correctionInput.effectiveFrom,
                    },
                  });
              }}
            >
              <h2 className="font-semibold">Correct active mapping</h2>
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded border bg-background p-2"
                  value={correctionId}
                  onChange={(e) => {
                    setCorrectionId(e.target.value);
                    clearPreview("correction");
                  }}
                >
                  <option value="">Select active mapping</option>
                  {data.mappings
                    .filter((mapping) => !mapping.effectiveTo)
                    .map((mapping) => (
                      <option key={mapping.id} value={mapping.id}>
                        {mapping.offerKey} to {mapping.salesSku.code}
                      </option>
                    ))}
                </select>
                <select
                  className="rounded border bg-background p-2"
                  value={correctionSkuId}
                  onChange={(e) => {
                    setCorrectionSkuId(e.target.value);
                    clearPreview("correction");
                  }}
                >
                  <option value="">Select replacement Sales SKU</option>
                  {skus.map((sku) => (
                    <option key={sku.id} value={sku.id}>
                      {sku.code}
                    </option>
                  ))}
                </select>
                <Input
                  type="date"
                  value={correctionDate}
                  onChange={(e) => {
                    setCorrectionDate(e.target.value);
                    clearPreview("correction");
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!correctionInput || previewing === "correction"}
                  onClick={() =>
                    correctionInput &&
                    preview("correction", correctionInput, correctionId)
                  }
                >
                  {previewing === "correction"
                    ? "Loading preview..."
                    : "Preview impact"}
                </Button>
                <Button disabled={!canConfirm("correction")}>
                  Confirm correction
                </Button>
              </div>
              {previews.correction && (
                <MappingImpactPreview preview={previews.correction} />
              )}
              {previewError.correction && (
                <p className="text-sm text-destructive">
                  {previewError.correction}
                </p>
              )}
            </form>
          </section>
        </>
      )}
      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">Mapping inbox</h2>
        <p className="text-sm text-muted-foreground">
          Exact SKU matches are suggestions. Preview impact before confirming.
        </p>
        <div className="mt-3 space-y-2">
          {data.candidates
            .filter((c) => matches(`${c.offerKey} ${c.normalizedSku}`))
            .map((candidate) => {
              const key =
                candidate.id ?? `${candidate.shopId}:${candidate.offerKey}`;
              const selected =
                candidateSalesSkuIds[key] ?? candidate.proposedSalesSkuId ?? "";
              const date = candidateDates[key] ?? today();
              const [externalProductId = "", externalVariantId = ""] =
                candidate.offerKey.split(":").slice(1);
              const input: MappingInput = {
                platform: "shopee",
                shopId: candidate.shopId,
                externalProductId,
                externalVariantId,
                offerKind: "variant",
                salesSkuId: selected,
                effectiveFrom: isoDate(date),
                candidateId: candidate.id,
              };
              return (
                <div
                  key={key}
                  className="space-y-2 rounded bg-muted p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <code>{candidate.offerKey}</code>
                    <span>
                      {candidate.confidence}: {candidate.normalizedSku}
                    </span>
                    {canMutate && (
                      <>
                        <select
                          className="rounded border bg-background p-1"
                          value={selected}
                          onChange={(event) => {
                            setCandidateSalesSkuIds((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }));
                            clearPreview(key);
                          }}
                        >
                          <option value="">Select Sales SKU</option>
                          {skus.map((sku) => (
                            <option key={sku.id} value={sku.id}>
                              {sku.code}
                            </option>
                          ))}
                        </select>
                        <Input
                          className="w-auto"
                          type="date"
                          value={date}
                          onChange={(event) => {
                            setCandidateDates((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }));
                            clearPreview(key);
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!selected || previewing === key}
                          onClick={() => preview(key, input)}
                        >
                          {previewing === key
                            ? "Loading preview..."
                            : "Preview impact"}
                        </Button>
                        <Button
                          size="sm"
                          disabled={!canConfirm(key)}
                          onClick={() =>
                            command.mutate({
                              command: "confirm-mapping",
                              data: input,
                            })
                          }
                        >
                          Confirm
                        </Button>
                        {candidate.id && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={command.isPending}
                            onClick={() =>
                              command.mutate({
                                command: "reject-candidate",
                                data: { candidateId: candidate.id },
                              })
                            }
                          >
                            Reject
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {previews[key] && (
                    <MappingImpactPreview preview={previews[key]} />
                  )}
                  {previewError[key] && (
                    <p className="text-destructive">{previewError[key]}</p>
                  )}
                </div>
              );
            })}
          {!data.candidates.length && (
            <p className="text-sm text-muted-foreground">No open candidates.</p>
          )}
        </div>
      </section>
      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">Confirmed mapping history</h2>
        <div className="mt-3 space-y-2 text-sm">
          {data.mappings
            .filter((m) =>
              matches(
                `${m.offerKey} ${m.salesSku.code} ${m.salesSku.family.name}`,
              ),
            )
            .map((mapping) => (
              <div key={mapping.id} className="rounded bg-muted p-2">
                <code>{mapping.offerKey}</code> to{" "}
                <strong>{mapping.salesSku.code}</strong> (
                {mapping.salesSku.family.name}),{" "}
                {new Date(mapping.effectiveFrom).toLocaleDateString()} to{" "}
                {mapping.effectiveTo
                  ? new Date(mapping.effectiveTo).toLocaleDateString()
                  : "present"}
                . Audit:{" "}
                {mapping.events
                  .map(
                    (event) =>
                      `${event.eventType} ${new Date(event.occurredAt).toLocaleDateString()}`,
                  )
                  .join(", ") || "confirmed record"}
              </div>
            ))}
        </div>
      </section>
      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">Recipe history</h2>
        {data.recipes.map((recipe) => (
          <p key={recipe.id} className="mt-2 text-sm">
            <strong>{recipe.salesSku.code}</strong>: {recipe.name}, effective{" "}
            {new Date(recipe.effectiveFrom).toLocaleDateString()},{" "}
            {recipe.components
              .map((c) => `${c.quantity} x ${c.product.sku}`)
              .join(", ")}
          </p>
        ))}
      </section>
      </>
      )}
      {command.error && (
        <p className="text-sm text-destructive">
          {command.error instanceof Error
            ? command.error.message
            : "The change could not be saved."}
        </p>
      )}
    </div>
  );
}
