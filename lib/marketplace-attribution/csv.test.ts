import { describe, expect, it } from "vitest";
import { csvIntraFileConflicts, parseMappingCsv } from "./csv";

describe("mapping CSV dry run", () => {
  const header = "platform,shopId,externalProductId,externalVariantId,salesSkuCode,effectiveFrom";
  const valid = "2026-01-01T00:00:00.000Z";
  it("requires stable platform, shop, product and variant identity", () => expect(parseMappingCsv(`${header}\nshopee,,12,4,sku-1,${valid}`).errors).toHaveLength(1));
  it("normalizes quoted global Sales SKU code before lookup", () => expect(parseMappingCsv(`${header}\nshopee,0123456789abcdef01234567,12,4,"sku-1",${valid}`).rows[0]!.salesSkuCode).toBe("SKU1"));
  it("handles quoted commas and newlines without split-based parsing", () => expect(parseMappingCsv(`${header}\nshopee,0123456789abcdef01234567,12,4,"sku,\n1",${valid}`).rows[0]!.salesSkuCode).toBe("SKU1"));
  it("rejects non-canonical dates and non-numeric source identifiers", () => expect(parseMappingCsv(`${header}\nshopee,0123456789abcdef01234567,12x,4,sku-1,2026-01-01`).errors).toHaveLength(1));
  it("canonicalizes leading-zero Shopee identities for stored offer keys", () => {
    const parsed = parseMappingCsv(`${header}\nshopee,0123456789abcdef01234567,00012,0004,sku-1,${valid}`);
    expect(parsed.rows[0]).toMatchObject({ externalProductId: "12", externalVariantId: "4" });
  });
  it("reports an overlap between rows for the same source offer", () => { const parsed = parseMappingCsv(`${header}\nshopee,0123456789abcdef01234567,12,4,sku-1,${valid}\nshopee,0123456789abcdef01234567,12,4,sku-2,2026-02-01T00:00:00.000Z`); expect(csvIntraFileConflicts(parsed.rows)).toEqual(["Row 3: overlaps CSV row 2."]); });
  it("detects duplicate offers after canonicalizing their identities", () => {
    const parsed = parseMappingCsv(`${header}\nshopee,0123456789abcdef01234567,00012,0004,sku-1,${valid}\nshopee,0123456789abcdef01234567,12,4,sku-2,2026-02-01T00:00:00.000Z`);
    expect(csvIntraFileConflicts(parsed.rows)).toEqual(["Row 3: overlaps CSV row 2."]);
  });
});
