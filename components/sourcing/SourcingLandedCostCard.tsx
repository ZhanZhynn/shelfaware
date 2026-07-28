"use client";

import { useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import {
  calculateSourcingLandedCost,
  normalizeSourcingCostConfig,
  type SourcingCostConfig,
  type SourcingLandedCostFlag,
  type SourcingLandedCostInput,
  type SourcingLandedCostResult,
} from "@/lib/sourcing/landed-cost";
import {
  useCreateSourcingCostScenario,
  useDeleteSourcingCostScenario,
  useSourcingCostScenarios,
  useSourcingCostSettings,
  useUpdateSourcingCostScenario,
} from "@/hooks/queries";

type Quote = SourcingLandedCostInput & {
  unitPriceRmb?: number | null;
  status?: string | null;
  landedCostSnapshot?: unknown;
};

type SettingsResponse = { config: SourcingCostConfig };
type SavedScenario = {
  id: string;
  quoteId: string;
  name: string;
  inputs: SourcingLandedCostInput;
  resultSnapshot: unknown;
  createdBy?: { name?: string | null; email?: string | null };
  updatedAt?: string | null;
};

const flagLabels: Record<SourcingLandedCostFlag, string> = {
  freight_excluded:
    "Freight excluded: carton dimensions or pieces per carton are missing.",
  shipping_overridden:
    "Shipping override is being used instead of volumetric freight.",
  no_market_price: "No market price: profit and ROI are unavailable.",
  placeholder: "Placeholder price detected. Verify before making a decision.",
  near_zero: "Near-zero supplier price detected. Verify the quoted unit.",
  margin_too_high:
    "Margin is implausibly high. Check the competitor pack basis.",
  basis_unverified:
    "Pack basis was assumed as one. Verify the listing or supplier pack count.",
};

const inputFields: Array<{
  key: keyof SourcingLandedCostInput;
  label: string;
  step?: string;
}> = [
  { key: "unitCostCny", label: "Supplier CNY / selling unit", step: "0.01" },
  { key: "piecesPerSellingUnit", label: "Pieces / selling unit", step: "1" },
  { key: "overrideCostMyr", label: "RM override / selling unit", step: "0.01" },
  { key: "cartonLengthCm", label: "Carton length (cm)", step: "0.1" },
  { key: "cartonWidthCm", label: "Carton width (cm)", step: "0.1" },
  { key: "cartonHeightCm", label: "Carton height (cm)", step: "0.1" },
  { key: "piecesPerCarton", label: "Pieces / carton", step: "1" },
  {
    key: "shippingOverrideMyrPerPiece",
    label: "Shipping override / piece (RM)",
    step: "0.01",
  },
  { key: "marketPriceMyr", label: "Competitor listing (RM)", step: "0.01" },
  { key: "marketPack", label: "Pieces / competitor listing", step: "1" },
];

const quoteInput = (quote: Quote): SourcingLandedCostInput => ({
  unitCostCny: quote.unitCostCny ?? quote.unitPriceRmb,
  piecesPerSellingUnit: quote.piecesPerSellingUnit,
  cartonLengthCm: quote.cartonLengthCm,
  cartonWidthCm: quote.cartonWidthCm,
  cartonHeightCm: quote.cartonHeightCm,
  piecesPerCarton: quote.piecesPerCarton,
  marketPriceMyr: quote.marketPriceMyr,
  marketPack: quote.marketPack,
  overrideCostMyr: quote.overrideCostMyr,
  shippingOverrideMyrPerPiece: null,
});

function isCostResult(value: unknown): value is SourcingLandedCostResult {
  return (
    !!value &&
    typeof value === "object" &&
    "landed" in value &&
    "flags" in value
  );
}

function moneyOrDash(value: number | null) {
  return value === null ? "-" : formatMoney(value, "MYR");
}

function percentageOrDash(value: number | null) {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

export function SourcingLandedCostCard({
  workspaceId,
  caseId,
  quoteId,
  quote,
}: {
  workspaceId: string;
  caseId: string;
  quoteId: string;
  quote: Quote;
}) {
  const { data: settingsData } = useSourcingCostSettings(workspaceId);
  const { data: scenarioData = [] } = useSourcingCostScenarios(caseId, true);
  const createScenario = useCreateSourcingCostScenario();
  const updateScenario = useUpdateSourcingCostScenario();
  const deleteScenario = useDeleteSourcingCostScenario();
  const config = normalizeSourcingCostConfig(
    (settingsData as SettingsResponse | undefined)?.config,
  );
  const sourceInput = quoteInput(quote);
  const [scenario, setScenario] =
    useState<SourcingLandedCostInput>(sourceInput);
  const [scenarioName, setScenarioName] = useState("");
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(
    null,
  );
  const result = calculateSourcingLandedCost(scenario, config);
  const submittedSnapshot =
    quote.status === "submitted" && isCostResult(quote.landedCostSnapshot)
      ? quote.landedCostSnapshot
      : null;
  const scenarios = (scenarioData as SavedScenario[]).filter(
    (entry) => entry.quoteId === quoteId,
  );
  const hasScenario = inputFields.some(
    ({ key }) => scenario[key] !== sourceInput[key],
  );

  const updateInput = (key: keyof SourcingLandedCostInput, value: string) => {
    setScenario((current) => ({
      ...current,
      [key]: value === "" ? null : Number(value),
    }));
  };
  const loadScenario = (saved: SavedScenario) => {
    setScenario(saved.inputs);
    setScenarioName(saved.name);
    setSelectedScenarioId(saved.id);
  };
  const saveScenario = async () => {
    if (!scenarioName.trim()) return;
    if (selectedScenarioId) {
      await updateScenario.mutateAsync({
        id: selectedScenarioId,
        name: scenarioName,
        inputs: scenario,
      });
      return;
    }
    const saved = await createScenario.mutateAsync({
      workspaceId,
      caseId,
      quoteId,
      name: scenarioName,
      inputs: scenario,
    });
    setSelectedScenarioId(saved.id);
  };
  const startNewScenario = () => {
    setSelectedScenarioId(null);
    setScenarioName("");
    setScenario(sourceInput);
  };
  const removeScenario = async (id: string) => {
    await deleteScenario.mutateAsync({ id });
    if (selectedScenarioId === id) startNewScenario();
  };

  const metrics = result
    ? [
        ["Carton volume", `${result.cartonM3.toFixed(5)} m3`],
        [
          "Product cost / piece",
          formatMoney(result.productCostPerPiece, "MYR"),
        ],
        ["Freight / piece", formatMoney(result.freightPerPiece, "MYR")],
        ["Landed / piece", formatMoney(result.landed, "MYR")],
        ["Keep rate", percentageOrDash(result.keepRate)],
        ["Market / piece", moneyOrDash(result.marketPerPiece)],
        ["Net revenue / piece", moneyOrDash(result.netRevenue)],
        ["Profit / piece", moneyOrDash(result.profitPerPiece)],
        ["ROI", percentageOrDash(result.roi)],
        [
          "Margin",
          percentageOrDash(
            result.marginPercent === null ? null : result.marginPercent / 100,
          ),
        ],
      ]
    : [];
  const pricing = result
    ? [
        ["Minimum viable price", moneyOrDash(result.minViablePrice)],
        ["Gold RSP", formatMoney(result.rspGold, "MYR")],
        ["Tier-2 RSP", formatMoney(result.rspTier2, "MYR")],
        ["Razor RSP", formatMoney(result.rspRazor, "MYR")],
      ]
    : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pricing comparison</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pricing.length ? (
            pricing.map(([label, value]) => (
              <p key={label} className="rounded-md border p-4">
                <b className="text-lg">{value}</b>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {label}
                </span>
              </p>
            ))
          ) : (
            <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">
              Add a supplier CNY cost or RM override to compare pricing floors.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Saved scenarios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-sm"
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
              maxLength={100}
              placeholder="Scenario name"
            />
            <Button
              type="button"
              disabled={!scenarioName.trim() || !result}
              isLoading={createScenario.isPending || updateScenario.isPending}
              onClick={saveScenario}
            >
              <Save className="h-4 w-4" />
              {selectedScenarioId ? "Update scenario" : "Save scenario"}
            </Button>
            <Button type="button" variant="outline" onClick={startNewScenario}>
              <Plus className="h-4 w-4" />
              New scenario
            </Button>
          </div>
          {scenarios.length ? (
            <div className="space-y-2">
              {scenarios.map((saved) => {
                const savedResult = isCostResult(saved.resultSnapshot)
                  ? saved.resultSnapshot
                  : null;
                return (
                  <div
                    key={saved.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <b>{saved.name}</b>
                      <p className="text-muted-foreground">
                        {savedResult
                          ? `Saved landed ${formatMoney(savedResult.landed, "MYR")} / piece`
                          : "Saved calculation"}
                        {saved.createdBy
                          ? ` by ${saved.createdBy.name || saved.createdBy.email}`
                          : ""}
                        {saved.updatedAt
                          ? ` · ${new Date(saved.updatedAt).toLocaleDateString()}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => loadScenario(saved)}
                    >
                      Load
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      isLoading={deleteScenario.isPending}
                      onClick={() => removeScenario(saved.id)}
                      aria-label={`Delete ${saved.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No saved scenarios for this quote.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>What-if calculation</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Uses current workspace settings. Changes here do not update the
                quotation or purchase order.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!hasScenario}
              onClick={() => setScenario(sourceInput)}
            >
              <RefreshCw className="h-4 w-4" />
              Reset to quotation
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            {inputFields.map(({ key, label, step }) => (
              <label key={key} className="grid gap-1 font-medium">
                {label}
                <Input
                  type="number"
                  min="0"
                  step={step}
                  value={scenario[key] ?? ""}
                  onChange={(event) => updateInput(key, event.target.value)}
                />
              </label>
            ))}
          </div>
          {!result ? (
            <p className="text-muted-foreground">
              Add a supplier CNY cost or RM override to calculate landed cost.
            </p>
          ) : (
            <>
              <p className="font-medium">
                Product {formatMoney(result.productCostPerPiece, "MYR")} +
                shipping {formatMoney(result.freightPerPiece, "MYR")} ={" "}
                <span className="text-base">
                  {formatMoney(result.landed, "MYR")}
                </span>{" "}
                / piece
              </p>
              {result.shippingOverrideMyrPerPiece !== null ? (
                <p className="text-muted-foreground">
                  Shipping override:{" "}
                  {formatMoney(result.shippingOverrideMyrPerPiece, "MYR")} /
                  piece
                </p>
              ) : result.cartonM3 > 0 && scenario.piecesPerCarton ? (
                <p className="text-muted-foreground">
                  Shipping: {result.cartonM3.toFixed(5)} m3 x{" "}
                  {formatMoney(config.shippingRateMyrPerM3, "MYR")} /{" "}
                  {scenario.piecesPerCarton} pieces per carton
                </p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {metrics.map(([label, value]) => (
                  <p key={label} className="rounded-md border p-3">
                    <b>{value}</b>
                    <span className="mt-1 block text-muted-foreground">
                      {label}
                    </span>
                  </p>
                ))}
              </div>
              {result.flags.length > 0 && (
                <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-950 dark:text-amber-200">
                  {result.flags.map((flag) => (
                    <p key={flag}>{flagLabels[flag]}</p>
                  ))}
                </div>
              )}
            </>
          )}
          {submittedSnapshot && (
            <div className="rounded-md border p-3 text-muted-foreground">
              <b className="text-foreground">Submitted snapshot:</b> landed{" "}
              {formatMoney(submittedSnapshot.landed, "MYR")} / piece, product{" "}
              {formatMoney(submittedSnapshot.productCostPerPiece, "MYR")},
              freight {formatMoney(submittedSnapshot.freightPerPiece, "MYR")}.
              This historical value is not changed by scenarios.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
