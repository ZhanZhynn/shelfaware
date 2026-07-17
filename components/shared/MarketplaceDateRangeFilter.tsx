"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "lucide-react";

interface DateRangeFilterProps {
  onDateRangeChange: (from: string | null, to: string | null) => void;
  initialFrom?: string | null;
  initialTo?: string | null;
}

const PRESET_RANGES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
] as const;

export default function MarketplaceDateRangeFilter({
  onDateRangeChange,
  initialFrom = null,
  initialTo = null,
}: DateRangeFilterProps) {
  const [dateFrom, setDateFrom] = useState<string | null>(initialFrom);
  const [dateTo, setDateTo] = useState<string | null>(initialTo);
  const [activePreset, setActivePreset] = useState<number | null>(null);

  const handlePreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);

    const fromStr = from.toISOString().split("T")[0] || "";
    const toStr = to.toISOString().split("T")[0] || "";

    setDateFrom(fromStr);
    setDateTo(toStr);
    setActivePreset(days);
    onDateRangeChange(fromStr, toStr);
  };

  const handleCustomDate = () => {
    setActivePreset(null);
    onDateRangeChange(dateFrom, dateTo);
  };

  const handleClear = () => {
    setDateFrom(null);
    setDateTo(null);
    setActivePreset(null);
    onDateRangeChange(null, null);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      {PRESET_RANGES.map((range) => (
        <Button
          key={range.days}
          variant={activePreset === range.days ? "default" : "ghost"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => handlePreset(range.days)}
        >
          {range.label}
        </Button>
      ))}
      <div className="flex items-center gap-1 ml-2">
        <Input
          type="date"
          value={dateFrom || ""}
          onChange={(e) => { setDateFrom(e.target.value || null); setActivePreset(null); }}
          className="h-7 w-[130px] text-xs"
          placeholder="From"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="date"
          value={dateTo || ""}
          onChange={(e) => { setDateTo(e.target.value || null); setActivePreset(null); }}
          className="h-7 w-[130px] text-xs"
          placeholder="To"
        />
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCustomDate}>
          Apply
        </Button>
        {(dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
