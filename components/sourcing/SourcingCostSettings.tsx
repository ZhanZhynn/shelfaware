"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { defaultSourcingCostConfig, type SourcingCostConfig } from "@/lib/sourcing/landed-cost";
import { useSourcingCostSettings, useUpdateSourcingCostSettings } from "@/hooks/queries";

type SettingsResponse = { config: SourcingCostConfig };

const fields: Array<{ key: keyof SourcingCostConfig; label: string; hint: string; step?: string }> = [
  { key: "fxCnyMyr", label: "CNY to RM FX", hint: "Review monthly", step: "0.0001" },
  { key: "productCostMultiplier", label: "Product cost multiplier", hint: "Duty, SST, agent handling", step: "0.01" },
  { key: "shippingRateMyrPerM3", label: "Shipping RM / m3", hint: "China to MY blended rate", step: "1" },
  { key: "shopeeFeePercent", label: "Marketplace fee %", hint: "Commission and payment", step: "0.01" },
  { key: "fulfilmentFeePercent", label: "Fulfilment fee %", hint: "Pick, pack, outbound", step: "0.01" },
  { key: "goldMarkup", label: "Gold markup", hint: "Suggested premium RSP", step: "0.01" },
  { key: "tier2Markup", label: "Tier-2 markup", hint: "Suggested commodity RSP", step: "0.01" },
  { key: "razorMarkup", label: "Razor markup", hint: "Quick pricing sanity check", step: "0.01" },
];

export function SourcingCostSettings({ workspaceId }: { workspaceId: string }) {
  const { data } = useSourcingCostSettings(workspaceId);
  const update = useUpdateSourcingCostSettings();
  const [formConfig, setFormConfig] = useState<SourcingCostConfig | null>(null);
  const config = formConfig || (data as SettingsResponse | undefined)?.config || defaultSourcingCostConfig;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Calculator className="mr-2 h-4 w-4" />
          Cost settings
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(560px,100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] space-y-4 overflow-y-auto text-sm" align="center" side="bottom" sideOffset={8} collisionPadding={16}>
        <div>
          <p className="font-medium">Sourcing cost settings</p>
          <p className="mt-1 text-muted-foreground">Shared team-wide. Changes affect new calculations; submitted quotes keep their parameter snapshot.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(({ key, label, hint, step }) => (
            <label key={key} className="grid gap-1 font-medium">
              {label}
              <Input type="number" min="0" step={step} value={config[key]} onChange={(event) => setFormConfig((current) => ({ ...(current || config), [key]: Number(event.target.value) }))} />
              <span className="text-xs font-normal text-muted-foreground">{hint}</span>
            </label>
          ))}
        </div>
        <Button isLoading={update.isPending} onClick={() => update.mutate({ workspaceId, ...config })}>Save cost settings</Button>
      </PopoverContent>
    </Popover>
  );
}
