import { normalizeCatalogCode } from "./intervals";
import { intervalsOverlap } from "./intervals";
import Papa from "papaparse";
import { normalizeShopeeExternalId } from "./shopee-external-id";

export type MappingCsvRow = {
  rowNumber: number;
  platform: "shopee";
  shopId: string;
  externalProductId: string;
  externalVariantId: string;
  salesSkuCode: string;
  effectiveFrom: string;
};

export const MAPPING_CSV_HEADER = [
  "platform",
  "shopId",
  "externalProductId",
  "externalVariantId",
  "salesSkuCode",
  "effectiveFrom",
];
const MAX_CSV_BYTES = 1024 * 1024;
const MAX_CSV_ROWS = 1000;
const MAX_CELL_LENGTH = 200;

export function strictUtcDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value
    ? null
    : date;
}

export function parseMappingCsv(csv: string) {
  if (!csv.trim())
    return { rows: [] as MappingCsvRow[], errors: ["The CSV is empty."] };
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES)
    return {
      rows: [] as MappingCsvRow[],
      errors: ["The CSV exceeds the 1 MB limit."],
    };
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: "greedy" });
  if (parsed.errors.length)
    return {
      rows: [] as MappingCsvRow[],
      errors: parsed.errors.map(
        (error) =>
          `CSV parse error at row ${(error.row ?? 0) + 1}: ${error.message}`,
      ),
    };
  const values = parsed.data;
  if (values.length - 1 > MAX_CSV_ROWS)
    return {
      rows: [] as MappingCsvRow[],
      errors: [`The CSV exceeds the ${MAX_CSV_ROWS} row limit.`],
    };
  const header = values[0];
  if (
    !header ||
    header.length !== MAPPING_CSV_HEADER.length ||
    header.some((value, index) => value !== MAPPING_CSV_HEADER[index])
  )
    return {
      rows: [] as MappingCsvRow[],
      errors: [`Expected header: ${MAPPING_CSV_HEADER.join(",")}`],
    };
  const rows: MappingCsvRow[] = [];
  const errors: string[] = [];
  values.slice(1).forEach((cells, index) => {
    const number = index + 2;
    if (cells.length !== 6) {
      errors.push(`Row ${number}: expected six comma-separated values.`);
      return;
    }
    if (cells.some((cell) => cell.length > MAX_CELL_LENGTH)) {
      errors.push(
        `Row ${number}: a value exceeds the ${MAX_CELL_LENGTH} character limit.`,
      );
      return;
    }
    const [
      platform = "",
      rawShopId = "",
      rawProductId = "",
      rawVariantId = "",
      rawSalesSkuCode = "",
      effectiveFrom = "",
    ] = cells;
    const shopId = rawShopId.trim();
    const salesSkuCode = rawSalesSkuCode.trim();
    if (platform.trim() !== "shopee" || !/^[a-f\d]{24}$/i.test(shopId)) {
      errors.push(
        `Row ${number}: platform must be shopee and shop/product/variant identifiers must be stable numeric values.`,
      );
      return;
    }
    if (!strictUtcDate(effectiveFrom.trim())) {
      errors.push(
        `Row ${number}: effectiveFrom must be a canonical ISO UTC timestamp (for example 2026-01-01T00:00:00.000Z).`,
      );
      return;
    }
    try {
      rows.push({
        rowNumber: number,
        platform: "shopee",
        shopId,
        externalProductId: normalizeShopeeExternalId(rawProductId.trim()),
        externalVariantId: normalizeShopeeExternalId(rawVariantId.trim()),
        salesSkuCode: normalizeCatalogCode(salesSkuCode),
        effectiveFrom: effectiveFrom.trim(),
      });
    } catch {
      errors.push(
        `Row ${number}: product and variant identifiers must be supported decimal values and SalesSku code must be valid.`,
      );
    }
  });
  return { rows, errors };
}

export function csvIntraFileConflicts(rows: MappingCsvRow[]) {
  const prior = new Map<string, MappingCsvRow[]>();
  const errors: string[] = [];
  for (const row of rows) {
    const key = `${row.shopId}:shopee:${row.externalProductId}:${row.externalVariantId}`;
    const existing = prior.get(key) ?? [];
    for (const other of existing)
      if (
        intervalsOverlap(
          { effectiveFrom: new Date(other.effectiveFrom), effectiveTo: null },
          { effectiveFrom: new Date(row.effectiveFrom), effectiveTo: null },
        )
      )
        errors.push(
          `Row ${row.rowNumber}: overlaps CSV row ${other.rowNumber}.`,
        );
    prior.set(key, [...existing, row]);
  }
  return errors;
}
