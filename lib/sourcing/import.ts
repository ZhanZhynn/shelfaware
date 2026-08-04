import ExcelJS from "exceljs";
import Papa from "papaparse";
import { sourcingCaseSchema, type SourcingCaseInput } from "@/lib/validations/sourcing";

const headers: Record<string, keyof Omit<SourcingCaseInput, "workspaceId">> = {
  title: "title", name: "title", description: "description", quantity: "requestedQuantity", requestedquantity: "requestedQuantity",
  targetunitpricemyr: "targetUnitPriceMyr", targetprice: "targetUnitPriceMyr", assigneeid: "assignedToId",
  size: "size", material: "material", variant: "variant", specifications: "specifications", referenceurl: "referenceUrl", notes: "notes",
};

const key = (value: unknown) => String(value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const cell = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === "object" && value && "result" in value ? String((value as { result?: unknown }).result ?? "") : String(value ?? "").trim();

export type SourcingImportPreview = { rows: SourcingCaseInput[]; errors: { row: number; message: string }[] };

export async function parseSourcingImport(file: File, workspaceId: string): Promise<SourcingImportPreview> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "xlsx"].includes(extension)) throw new Error("Upload a CSV or XLSX file");
  if (file.size > 5 * 1024 * 1024) throw new Error("Import files must be 5 MB or smaller");
  let records: Record<string, unknown>[] = [];
  if (extension === "csv") {
    const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: "greedy" });
    if (parsed.errors.length) throw new Error(`Invalid CSV: ${parsed.errors[0]?.message}`);
    records = parsed.data;
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer() as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("Workbook has no worksheet");
    const columns: Record<number, string> = {};
    sheet.getRow(1).eachCell((value, index) => { columns[index] = cell(value.value); });
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber); const record: Record<string, unknown> = {};
      row.eachCell((value, index) => { if (columns[index]) record[columns[index]] = cell(value.value); });
      if (Object.values(record).some(Boolean)) records.push(record);
    }
  }
  if (!records.length) throw new Error("Import file has no data rows");
  if (records.length > 200) throw new Error("Imports are limited to 200 cases");
  const rows: SourcingCaseInput[] = []; const errors: { row: number; message: string }[] = [];
  records.forEach((record, index) => {
    const input: Record<string, unknown> = { workspaceId };
    Object.entries(record).forEach(([header, value]) => { const field = headers[key(header)]; if (field) input[field] = value; });
    const result = sourcingCaseSchema.safeParse(input);
    if (result.success) rows.push(result.data); else errors.push({ row: index + 2, message: result.error.issues.map((issue) => issue.message).join(", ") });
  });
  return { rows, errors };
}
