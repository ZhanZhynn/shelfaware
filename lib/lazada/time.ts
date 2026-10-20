const timeZones: Record<string, string> = { my: "Asia/Kuala_Lumpur", sg: "Asia/Singapore", th: "Asia/Bangkok", vn: "Asia/Ho_Chi_Minh", ph: "Asia/Manila", id: "Asia/Jakarta" };
const months: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };

export type LazadaSyncRange = { from: string; to: string; basis?: "created" | "updated" };

export function lazadaTimestamp(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid Lazada timestamp");
  return date.toISOString().replace(/\.\d{3}Z$/, "+0000");
}

/** Date-only provider filters refer to the marketplace calendar, not UTC. */
export function lazadaCalendarDate(value: string | Date, countryCode: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Invalid Lazada calendar date");
    return value;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid Lazada calendar date");
  const timeZone = timeZones[countryCode];
  if (!timeZone) throw new Error("Lazada marketplace timezone is unknown");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}

/** Lazada's unzoned source timestamps use the shop's marketplace clock. */
export function lazadaSourceDate(value: unknown, countryCode: string): Date | null {
  if ((typeof value === "string" && /^\d{13}$/.test(value)) || (typeof value === "number" && Number.isSafeInteger(value) && value >= 1_000_000_000_000 && value < 10_000_000_000_000)) {
    const date = new Date(Number(value));
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(\.\d+)?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/.exec(raw);
  if (!match) return null;
  const calendar = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== match[1]) return null;
  const offset = match[4] ?? (["my", "sg", "ph"].includes(countryCode) ? "+08:00" : ["th", "vn", "id"].includes(countryCode) ? "+07:00" : null);
  if (!offset) return null;
  const date = new Date(`${match[1]}T${match[2] ?? "00:00:00"}${match[3] ?? ""}${offset}`);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Finance dates can use English month names. Date-only values identify the
 * marketplace accounting day; they are never a release or delivery timestamp. */
export function lazadaFinanceDate(value: unknown, countryCode: string): Date | null {
  if (typeof value === "string") {
    const monthFirst = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(value.trim());
    const source = monthFirst ? `${monthFirst[2]} ${monthFirst[1]} ${monthFirst[3]}` : value.trim();
    const english = /^(\d{1,2})[\s-]+([A-Za-z]+),?[\s-]+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(source);
    if (english) {
      const month = months[english[2]!.toLowerCase()];
      if (!month) return null;
      const iso = `${english[3]}-${String(month).padStart(2, "0")}-${english[1]!.padStart(2, "0")}T${(english[4] ?? "00").padStart(2, "0")}:${english[5] ?? "00"}:${english[6] ?? "00"}`;
      return lazadaSourceDate(iso, countryCode);
    }
  }
  return lazadaSourceDate(value, countryCode);
}
