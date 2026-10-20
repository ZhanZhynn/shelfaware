/** Operational source amounts remain unknown if any component is unavailable. */
export function sumLazadaSourceMoney(values: readonly (number | null | undefined)[]): number | null {
  if (!values.length) return null;
  const parts = values.map((value) => typeof value === "number" && Number.isFinite(value) ? /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value)) : null);
  if (parts.some((part) => !part)) return null;
  const scale = Math.max(...parts.map((part) => part?.[3]?.length ?? 0));
  if (scale > 12) return null;
  const minor = parts.reduce((sum, part) => sum + BigInt(`${part![1]}${part![2]}${(part![3] ?? "").padEnd(scale, "0")}`), 0n);
  return minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(minor) / 10 ** scale;
}

export function lazadaSourceMoney(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
