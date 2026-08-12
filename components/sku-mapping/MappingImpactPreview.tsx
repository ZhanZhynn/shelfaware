type MappingPreview = {
  affectedLines: number;
  affectedUnits: number;
  nativeRevenueByCurrency: Record<string, { minorUnits: string; scale: number }>;
  dateRange: { from: string; to: string } | null;
  overlapWarning: string | null;
  unverifiableLegacyLines: number;
  exclusionWarning: string;
};

export function MappingImpactPreview({ preview }: { preview: MappingPreview }) {
  const money = (value: { minorUnits: string; scale: number }, currency: string) => {
    const amount = Number(value.minorUnits) / 10 ** value.scale;
    return currency === "UNKNOWN" ? amount.toFixed(value.scale) : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  };
  return <div className="rounded border border-amber-500/50 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
    <p className="font-medium">Historical impact preview</p>
    <p>{preview.affectedLines} affected sale lines, {preview.affectedUnits} sellable units.</p>
    <p>Native revenue: {Object.entries(preview.nativeRevenueByCurrency).map(([currency, value]) => `${money(value, currency)} ${currency}`).join(", ") || "No eligible revenue."}</p>
    <p>Sales: {preview.dateRange ? `${new Date(preview.dateRange.from).toLocaleDateString()} to ${new Date(preview.dateRange.to).toLocaleDateString()}` : "No eligible sales."}</p>
    <p className="text-muted-foreground">{preview.exclusionWarning}</p>
    {preview.overlapWarning && <p className="font-medium text-destructive">{preview.overlapWarning}</p>}
  </div>;
}
