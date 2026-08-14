import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const workspaceName = process.env.SITEGIANT_WORKSPACE_NAME?.trim() || "SA";
const inventoryPath = process.env.SITEGIANT_INVENTORY_PATH?.trim() || "docs/inventory_listing.xlsx";
const kitPath = process.env.SITEGIANT_KIT_PATH?.trim() || "docs/kit_sku.xlsx";
const effectiveFrom = new Date("2000-01-01T00:00:00.000Z");

type InventoryItem = {
  sku: string;
  name: string;
  isKit: boolean;
  price: number;
  sellableStock: number;
  active: boolean;
};

type RecipeLine = { kitSku: string; componentSku: string; quantity: number };

function text(value: ExcelJS.CellValue) {
  return String(value ?? "").trim();
}

function number(value: ExcelJS.CellValue, field: string, sku: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} is not numeric for ${sku}.`);
  return parsed;
}

async function retry<T>(operation: () => Promise<T>, label: string) {
  let failure: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await operation();
    } catch (error) {
      failure = error;
      if (attempt === 4) break;
      console.warn(`${label} failed (attempt ${attempt}/4); retrying.`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw failure;
}

async function readInventory() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inventoryPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Inventory workbook has no worksheet.");

  const items = new Map<string, InventoryItem>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const sku = text(row.getCell(2).value);
    if (!sku) throw new Error(`Inventory row ${rowNumber} is missing ISKU.`);
    if (items.has(sku)) throw new Error(`Inventory ISKU ${sku} is duplicated.`);
    const kit = text(row.getCell(3).value).toLowerCase();
    const status = text(row.getCell(9).value).toLowerCase();
    if (kit !== "yes" && kit !== "no") throw new Error(`Inventory is_kit is invalid for ${sku}.`);
    if (status !== "active" && status !== "inactive") throw new Error(`Inventory item_status is invalid for ${sku}.`);
    items.set(sku, {
      sku,
      name: text(row.getCell(1).value),
      isKit: kit === "yes",
      price: number(row.getCell(5).value, "price", sku),
      sellableStock: number(row.getCell(7).value, "sellable_stock", sku),
      active: status === "active",
    });
  });
  return items;
}

async function readRecipes() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(kitPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Kit workbook has no worksheet.");

  const lines: RecipeLine[] = [];
  let kitSku = "";
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    kitSku = text(row.getCell(2).value) || kitSku;
    const componentSku = text(row.getCell(4).value);
    if (!kitSku) throw new Error(`Kit row ${rowNumber} appears before a kit parent.`);
    if (!componentSku) throw new Error(`Kit row ${rowNumber} is missing item_isku.`);
    const quantity = number(row.getCell(5).value, "quantity", kitSku);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Kit quantity must be a positive integer for ${kitSku}.`);
    lines.push({ kitSku, componentSku, quantity });
  });
  return lines;
}

async function main() {
  const [items, recipeLines] = await Promise.all([readInventory(), readRecipes()]);
  const kitSkus = new Set([...items.values()].filter((item) => item.isKit).map((item) => item.sku));
  const recipeParents = new Set(recipeLines.map((line) => line.kitSku));
  if (kitSkus.size !== recipeParents.size || [...kitSkus].some((sku) => !recipeParents.has(sku)))
    throw new Error("Kit workbook parents do not exactly match inventory is_kit=yes rows.");
  for (const line of recipeLines) {
    const component = items.get(line.componentSku);
    if (!component) throw new Error(`Recipe component ${line.componentSku} does not exist in inventory.`);
    if (component.isKit) throw new Error(`Recipe ${line.kitSku} contains nested kit ${line.componentSku}.`);
  }

  const workspace = await prisma.workspace.findFirst({ where: { name: workspaceName }, orderBy: { createdAt: "asc" } });
  if (!workspace) throw new Error(`Workspace ${workspaceName} was not found.`);
  const actorId = process.env.SITEGIANT_ACTOR_ID?.trim() || workspace.ownerId;
  const nonKits = [...items.values()].filter((item) => !item.isKit);
  const kits = [...items.values()].filter((item) => item.isKit);
  const existingProducts = await prisma.product.findMany({
    where: { skuScopeId: workspace.id, sku: { in: nonKits.map((item) => item.sku) } },
    select: { sku: true },
  });
  const existingSalesSkus = await prisma.salesSku.findMany({
    where: { code: { in: [...items.keys()] } },
    select: { code: true },
  });

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    workspace: { id: workspace.id, name: workspace.name },
    inventory: { total: items.size, nonKit: nonKits.length, kit: kits.length, active: [...items.values()].filter((item) => item.active).length },
    recipes: { rows: recipeLines.length, kits: recipeParents.size },
    existing: { products: existingProducts.length, salesSkus: existingSalesSkus.length },
    toCreate: { products: nonKits.length - existingProducts.length, salesSkus: items.size - existingSalesSkus.length },
  }, null, 2));
  if (!apply) return;

  const [category, supplier, family] = await prisma.$transaction(async (tx) => {
    const category = (await tx.category.findFirst({ where: { workspaceId: workspace.id, name: "Sitegiant Import" } }))
      ?? await tx.category.create({ data: { name: "Sitegiant Import", userId: actorId, workspaceId: workspace.id, createdBy: actorId } });
    const supplier = (await tx.supplier.findFirst({ where: { workspaceId: workspace.id, name: "Sitegiant" } }))
      ?? await tx.supplier.create({ data: { name: "Sitegiant", normalizedName: "sitegiant", userId: actorId, workspaceId: workspace.id, createdBy: actorId } });
    const family = (await tx.productFamily.findUnique({ where: { code: "SITEGIANT" } }))
      ?? await tx.productFamily.create({ data: { code: "SITEGIANT", name: "Sitegiant Catalog", createdById: actorId } });
    return [category, supplier, family] as const;
  });

  const existingProductSkus = new Set(existingProducts.map((product) => product.sku));
  const existingSalesSkuCodes = new Set(existingSalesSkus.map((sku) => sku.code));
  const productsToCreate = nonKits.filter((item) => !existingProductSkus.has(item.sku));
  const salesSkusToCreate = [...items.values()].filter((item) => !existingSalesSkuCodes.has(item.sku));
  if (productsToCreate.length) {
    await retry(() => prisma.product.createMany({
      data: productsToCreate.map((item) => ({
        sku: item.sku, name: item.name, price: item.price, quantity: BigInt(item.sellableStock),
        status: item.active ? "active" : "inactive", categoryId: category.id, supplierId: supplier.id,
        userId: actorId, workspaceId: workspace.id, skuScopeId: workspace.id, createdBy: actorId,
      })),
    }), "Sitegiant products");
  }
  if (salesSkusToCreate.length) {
    await retry(() => prisma.salesSku.createMany({
      data: salesSkusToCreate.map((item) => ({
        code: item.sku, name: item.name, isKit: item.isKit, active: item.active, familyId: family.id, createdById: actorId,
      })),
    }), "Sitegiant Sales SKUs");
  }
  await Promise.all([
    prisma.salesSku.updateMany({
      where: { code: { in: kits.map((item) => item.sku) } },
      data: { isKit: true },
    }),
    prisma.salesSku.updateMany({
      where: { code: { in: nonKits.map((item) => item.sku) } },
      data: { isKit: false },
    }),
  ]);

  const [salesSkus, products] = await Promise.all([
    prisma.salesSku.findMany({ where: { code: { in: [...items.keys()] } }, select: { id: true, code: true } }),
    prisma.product.findMany({ where: { skuScopeId: workspace.id, sku: { in: nonKits.map((item) => item.sku) } }, select: { id: true, sku: true } }),
  ]);
  const salesSkuId = new Map(salesSkus.map((item) => [item.code, item.id]));
  const productId = new Map(products.map((item) => [item.sku, item.id]));
  const memberships = await prisma.salesSkuFamilyMembership.findMany({
    where: { salesSkuId: { in: salesSkus.map((sku) => sku.id) }, effectiveFrom },
    select: { salesSkuId: true },
  });
  const membershipSkuIds = new Set(memberships.map((membership) => membership.salesSkuId));
  const membershipsToCreate = salesSkus
    .filter((sku) => !membershipSkuIds.has(sku.id))
    .map((sku) => ({ salesSkuId: sku.id, productFamilyId: family.id, effectiveFrom, createdById: actorId }));
  if (membershipsToCreate.length)
    await retry(() => prisma.salesSkuFamilyMembership.createMany({ data: membershipsToCreate }), "Sitegiant Sales SKU memberships");
  const componentsByKit = new Map<string, { productId: string; quantity: number }[]>();
  for (const line of recipeLines) {
    const components = componentsByKit.get(line.kitSku) ?? [];
    components.push({ productId: productId.get(line.componentSku)!, quantity: line.quantity });
    componentsByKit.set(line.kitSku, components);
  }
  const existingRecipes = await prisma.salesSkuRecipe.findMany({
    where: { salesSkuId: { in: salesSkus.map((sku) => sku.id) }, effectiveFrom, status: "confirmed" },
    select: { salesSkuId: true },
  });
  const recipeSkuIds = new Set(existingRecipes.map((recipe) => recipe.salesSkuId));
  const recipesToCreate = [...items.values()]
    .filter((item) => !recipeSkuIds.has(salesSkuId.get(item.sku)!))
    .map((item) => ({ salesSkuId: salesSkuId.get(item.sku)!, name: item.sku, effectiveFrom, createdById: actorId }));
  if (recipesToCreate.length)
    await retry(() => prisma.salesSkuRecipe.createMany({ data: recipesToCreate }), "Sitegiant recipes");
  const recipes = await prisma.salesSkuRecipe.findMany({
    where: { salesSkuId: { in: salesSkus.map((sku) => sku.id) }, effectiveFrom, status: "confirmed" },
    select: { id: true, salesSkuId: true, components: { select: { productId: true } } },
  });
  const codeBySalesSkuId = new Map(salesSkus.map((sku) => [sku.id, sku.code]));
  const recipeComponents = recipes.flatMap((recipe) => {
    if (recipe.components.length) return [];
    const sku = codeBySalesSkuId.get(recipe.salesSkuId)!;
    const components = items.get(sku)!.isKit
      ? componentsByKit.get(sku)!
      : [{ productId: productId.get(sku)!, quantity: 1 }];
    return components.map((component) => ({ recipeId: recipe.id, ...component }));
  });
  if (recipeComponents.length)
    await retry(() => prisma.salesSkuRecipeComponent.createMany({ data: recipeComponents }), "Sitegiant recipe components");
  console.log("Sitegiant catalog import completed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
