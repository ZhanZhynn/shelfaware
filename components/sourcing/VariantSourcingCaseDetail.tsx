"use client";
/* eslint-disable @next/next/no-img-element -- sourcing attachments require authenticated URLs. */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  CircleAlert,
  FileText,
  PackagePlus,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useCreateSourcingComment,
  useSourcingCase,
  useSourcingCommand,
  useSourcingSuppliers,
} from "@/hooks/queries";
import { normalizeSourcingCostConfig } from "@/lib/sourcing/landed-cost";
import { variantViability } from "@/lib/sourcing/variant-viability";
import {
  getSourcingTimeline,
  getSourcingTimelineIndex,
} from "@/lib/sourcing/presentation";

type SheetLine = {
  availability: "available" | "unavailable";
  unitPriceRmb: string;
  piecesPerSellingUnit: string;
  cartonLengthCm: string;
  cartonWidthCm: string;
  cartonHeightCm: string;
  piecesPerCarton: string;
  marketPriceMyr: string;
  marketPack: string;
  moq: string;
  leadTimeDays: string;
  notes: string;
};
const emptyLine = (): SheetLine => ({
  availability: "available",
  unitPriceRmb: "",
  piecesPerSellingUnit: "1",
  cartonLengthCm: "",
  cartonWidthCm: "",
  cartonHeightCm: "",
  piecesPerCarton: "",
  marketPriceMyr: "",
  marketPack: "1",
  moq: "",
  leadTimeDays: "",
  notes: "",
});
const asNumber = (value: string) => (value === "" ? undefined : Number(value));
const label = (variant: any) =>
  [variant.size, variant.material, variant.colour]
    .filter(Boolean)
    .join(" / ") || "Standard";
const statusStyle: Record<string, string> = {
  pass: "bg-emerald-100 text-emerald-800",
  fail: "bg-red-100 text-red-800",
  needs_data: "bg-amber-100 text-amber-800",
};

export default function VariantSourcingCaseDetail({
  caseId,
  basePath,
}: {
  caseId: string;
  basePath: string;
}) {
  const { data: item, isLoading, error } = useSourcingCase(caseId);
  const command = useSourcingCommand();
  const comment = useCreateSourcingComment();
  const { data: suppliers = [] } = useSourcingSuppliers(
    item?.workspaceId || "",
  );
  const admin = basePath.startsWith("/admin");
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [sheetNotes, setSheetNotes] = useState("");
  const [lines, setLines] = useState<Record<string, SheetLine>>({});
  const [activeVariantId, setActiveVariantId] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, string>>({});
  const [commentBody, setCommentBody] = useState("");
  const [batchVariantIds, setBatchVariantIds] = useState<string[]>([]);
  const [batch, setBatch] = useState({
    availability: "available",
    unitPriceRmb: "",
    piecesPerSellingUnit: "",
    cartonLengthCm: "",
    cartonWidthCm: "",
    cartonHeightCm: "",
    piecesPerCarton: "",
    marketPriceMyr: "",
    marketPack: "",
    moq: "",
  });
  useEffect(() => {
    if (!item?.variants) return;
    setLines((current) =>
      Object.fromEntries(
        item.variants.map((variant: any) => [
          variant.id,
          current[variant.id] || emptyLine(),
        ]),
      ),
    );
    setActiveVariantId((current) => current || item.variants[0]?.id || "");
    setSelected(
      Object.fromEntries(
        item.variants
          .filter((variant: any) => variant.selection?.status === "selected")
          .map((variant: any) => [variant.id, variant.selection.quoteLineId]),
      ),
    );
    setSkipped(
      Object.fromEntries(
        item.variants
          .filter((variant: any) => variant.selection?.status === "skipped")
          .map((variant: any) => [
            variant.id,
            variant.selection.skipReason || "",
          ]),
      ),
    );
  }, [item?.id]);
  if (isLoading)
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </main>
    );
  if (error || !item)
    return (
      <main className="p-6 text-destructive">
        Unable to load sourcing request.
      </main>
    );
  const submittedLines = item.quotes.flatMap((quote: any) =>
    quote.status === "submitted"
      ? quote.lines.map((line: any) => ({ ...line, quote }))
      : [],
  );
  const supplierSheets = Object.values(
    item.quotes.reduce((groups: Record<string, any>, quote: any) => {
      const key = quote.quoteGroupId || quote.id;
      if (!groups[key] || groups[key].revision < quote.revision)
        groups[key] = quote;
      return groups;
    }, {}),
  ).filter((quote: any) =>
    ["draft", "submitted"].includes(quote.status),
  ) as any[];
  const activeVariant = item.variants.find(
    (variant: any) => variant.id === activeVariantId,
  );
  const offers = submittedLines.filter(
    (line: any) => line.caseVariantId === activeVariantId,
  );
  const selectedOfferLines = submittedLines.filter(
    (line: any) => selected[line.caseVariantId] === line.id,
  );
  const selectedBySupplier = selectedOfferLines.reduce(
    (groups: Record<string, any[]>, line: any) => {
      (groups[line.quote.supplierName] ||= []).push(line);
      return groups;
    },
    {},
  );
  const costConfig = normalizeSourcingCostConfig(item.costConfig);
  const caseAttachments = (item.attachments || []).filter(
    (attachment: any) => !attachment.quoteId,
  );
  const caseImages = caseAttachments.filter((attachment: any) =>
    attachment.mimeType?.startsWith("image/"),
  );
  const caseFiles = caseAttachments.filter(
    (attachment: any) => !attachment.mimeType?.startsWith("image/"),
  );
  const totalUnits = item.variants.reduce(
    (total: number, variant: any) => total + variant.requestedQuantity,
    0,
  );
  const viewer = admin ? "admin" : "sourcer";
  const timelineSteps = getSourcingTimeline(viewer);
  const timelineIndex = getSourcingTimelineIndex(item.stage, viewer);
  const currentTimelineLabel =
    timelineSteps.find((step) => step.id === item.stage)?.label || item.stage;
  const action = admin
    ? item.stage === "quoted"
      ? [
          "Your next step",
          "Review variant offers",
          "Choose one passed offer or explicitly skip each requested variant.",
        ]
      : item.stage === "approved"
        ? [
            "Your next step",
            "Create supplier orders",
            "Review the supplier groups and create the purchase orders.",
          ]
        : item.stage === "sourcing"
          ? [
              "Current progress",
              "Sourcer is collecting offers",
              "Wait for supplier quote sheets to be submitted.",
            ]
          : [
              "Current progress",
              currentTimelineLabel,
              "Track the sourcing request and its supplier orders.",
            ]
    : item.stage === "sourcing" || item.stage === "changes_requested"
      ? [
          "Your next step",
          "Complete a supplier quote sheet",
          "Record every requested variant for this supplier, then submit before moving on.",
        ]
      : item.stage === "quoted"
        ? [
            "Current progress",
            "Waiting for admin review",
            "The admin will choose viable variant offers or request changes.",
          ]
        : item.stage === "ordered"
          ? [
              "Your next step",
              "Arrange shipment",
              "Open each supplier purchase order to add tracking and mark it shipped.",
            ]
          : [
              "Current progress",
              currentTimelineLabel,
              "Follow the sourcing request progress here.",
            ];
  const sheetPayload = () => ({
    supplierId: supplierId || null,
    supplierName,
    paymentTerms: paymentTerms || null,
    notes: sheetNotes || null,
    lines: item.variants.map((variant: any) => ({
      caseVariantId: variant.id,
      ...Object.fromEntries(
        Object.entries(lines[variant.id] || emptyLine()).map(([key, value]) => [
          key,
          ["availability", "notes"].includes(key)
            ? value
            : asNumber(value as string),
        ]),
      ),
    })),
  });
  const submitSheet = () =>
    command.mutate({
      id: item.id,
      action: "submit_variant_quote",
      version: item.version,
      quoteId: activeSheetId || undefined,
      quoteSheet: sheetPayload(),
    });
  const saveSheet = () =>
    command.mutate({
      id: item.id,
      action: "save_variant_quote",
      version: item.version,
      quoteId: activeSheetId || undefined,
      quoteSheet: sheetPayload(),
    });
  const selectSheet = (sheet: any) => {
    setActiveSheetId(sheet.id);
    setSupplierId(sheet.supplierId || "");
    setSupplierName(sheet.supplierName);
    setPaymentTerms(sheet.paymentTerms || "");
    setSheetNotes(sheet.notes || "");
    setLines(
      Object.fromEntries(
        item.variants.map((variant: any) => {
          const line = sheet.lines.find(
            (entry: any) => entry.caseVariantId === variant.id,
          );
          return [
            variant.id,
            line
              ? {
                  availability: line.availability,
                  unitPriceRmb: line.unitPriceRmb?.toString() || "",
                  piecesPerSellingUnit:
                    line.piecesPerSellingUnit?.toString() || "1",
                  cartonLengthCm: line.cartonLengthCm?.toString() || "",
                  cartonWidthCm: line.cartonWidthCm?.toString() || "",
                  cartonHeightCm: line.cartonHeightCm?.toString() || "",
                  piecesPerCarton: line.piecesPerCarton?.toString() || "",
                  marketPriceMyr: line.marketPriceMyr?.toString() || "",
                  marketPack: line.marketPack?.toString() || "1",
                  moq: line.moq?.toString() || "",
                  leadTimeDays: line.leadTimeDays?.toString() || "",
                  notes: line.notes || "",
                }
              : emptyLine(),
          ];
        }),
      ),
    );
  };
  const selectSupplier = (supplier: any) => {
    const existingSheet = supplierSheets.find(
      (sheet: any) =>
        sheet.supplierId === supplier.id ||
        sheet.supplierName.toLowerCase() === supplier.name.toLowerCase(),
    );
    if (existingSheet) selectSheet(existingSheet);
    else {
      setActiveSheetId(null);
      setSupplierId(supplier.id);
      setSupplierName(supplier.name);
      setPaymentTerms("");
      setSheetNotes("");
      setLines({});
    }
    setSupplierSearch("");
    setSupplierPickerOpen(false);
  };
  const selectNewSupplierName = (name: string) => {
    setActiveSheetId(null);
    setSupplierId("");
    setSupplierName(name.trim());
    setPaymentTerms("");
    setSheetNotes("");
    setLines({});
    setSupplierSearch("");
    setSupplierPickerOpen(false);
  };
  const applyBatch = () =>
    setLines((current) =>
      Object.fromEntries(
        item.variants
          .filter((variant: any) => batchVariantIds.includes(variant.id))
          .map((variant: any) => {
            const line = { ...(current[variant.id] || emptyLine()) };
            for (const [field, value] of Object.entries(batch))
              if (value !== "") (line as any)[field] = value;
            return [variant.id, line];
          }),
      ),
    );
  const confirmSelections = () =>
    command.mutate({
      id: item.id,
      action: "confirm_variant_selection",
      version: item.version,
      selections: item.variants.map((variant: any) =>
        selected[variant.id]
          ? {
              caseVariantId: variant.id,
              quoteLineId: selected[variant.id],
              status: "selected",
            }
          : {
              caseVariantId: variant.id,
              status: "skipped",
              skipReason: skipped[variant.id] || "No viable offer selected",
            },
      ),
    });
  const updateLine = (
    variantId: string,
    field: keyof SheetLine,
    value: string,
  ) =>
    setLines((current) => ({
      ...current,
      [variantId]: { ...(current[variantId] || emptyLine()), [field]: value },
    }));
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="text-sm text-sky-600" href={basePath}>
            Sourcing
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{item.title}</h1>
          <p className="mt-1 text-muted-foreground">
            {item.specifications || "Variant sourcing request"}
          </p>
        </div>
        <Badge>{item.stage.replaceAll("_", " ")}</Badge>
      </div>
      <Card
        className={
          item.stage === "quoted" || item.stage === "approved"
            ? "border-sky-300 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/20"
            : ""
        }
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {action[0]}
            </p>
            <p className="mt-1 text-lg font-semibold">{action[1]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{action[2]}</p>
          </div>
          {admin && item.stage === "quoted" && (
            <Button asChild>
              <a href="#variant-offers">Review variant offers</a>
            </Button>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Request summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <b>Variants:</b> {item.variants.length}
          </p>
          <p>
            <b>Requested units:</b> {totalUnits}
          </p>
          <p>
            <b>Assignee:</b>{" "}
            {item.assignee?.name || item.assignee?.email || "Unassigned"}
          </p>
          <p>
            <b>Reference:</b>{" "}
            {item.referenceUrl ? (
              <a
                className="text-sky-600 underline"
                href={item.referenceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open link
              </a>
            ) : (
              "None"
            )}
          </p>
          <p className="sm:col-span-2">
            <b>Specifications:</b>{" "}
            {item.specifications || item.description || "None"}
          </p>
          <p className="sm:col-span-2">
            <b>Notes:</b> {item.notes || "None"}
          </p>
        </CardContent>
      </Card>
      {caseAttachments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Reference images and files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {caseImages.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {caseImages.map((attachment: any) => (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-lg border bg-muted/20"
                  >
                    <img
                      src={attachment.url}
                      alt={attachment.fileName}
                      className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <span className="block truncate px-2 py-1.5 text-xs text-muted-foreground">
                      {attachment.fileName}
                    </span>
                  </a>
                ))}
              </div>
            )}
            {caseFiles.length > 0 && (
              <div className="space-y-2">
                {caseFiles.map((attachment: any) => (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded border px-3 py-2 text-sm hover:text-sky-600"
                  >
                    <FileText className="h-4 w-4" />
                    {attachment.fileName}
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-4">
          <div className="flex min-w-max items-start overflow-x-auto">
            {timelineSteps.map((step, index) => {
              const done = timelineIndex >= index;
              const current = timelineIndex === index;
              return (
                <div key={step.id} className="flex items-start">
                  <div className="flex w-20 flex-col items-center text-center">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${done ? "border-sky-600 bg-sky-600 text-white" : "border-muted-foreground/30"}`}
                    >
                      {done && !current ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span
                      className={`mt-2 text-xs ${current ? "font-medium" : "text-muted-foreground"}`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < timelineSteps.length - 1 && (
                    <span
                      className={`mt-3 h-px w-8 sm:w-12 ${timelineIndex > index ? "bg-sky-600" : "bg-muted-foreground/25"}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{action[2]}</p>
        </CardContent>
      </Card>
      {admin ? (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium">Requested variants</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.variants.map((variant: any) => (
                <button
                  type="button"
                  key={variant.id}
                  onClick={() => setActiveVariantId(variant.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${activeVariantId === variant.id ? "border-sky-600 bg-sky-600 text-white" : "bg-background"}`}
                >
                  {label(variant)}{" "}
                  <span className="opacity-75">
                    x{variant.requestedQuantity}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Supplier quote sheets</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select a supplier sheet to continue editing it, or add another
                  supplier.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {supplierSheets.length ? (
              supplierSheets.map((sheet: any) => (
                <button
                  type="button"
                  key={sheet.id}
                  onClick={() => selectSheet(sheet)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${activeSheetId === sheet.id ? "border-sky-600 bg-sky-50" : "hover:bg-muted/50"}`}
                >
                  <span className="block font-medium">
                    {sheet.supplierName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {sheet.status === "submitted" ? "Submitted" : "Draft"} ·{" "}
                    {
                      sheet.lines.filter(
                        (line: any) => line.availability === "available",
                      ).length
                    }
                    /{item.variants.length} available
                  </span>
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No supplier sheets yet. Add the first supplier to begin.
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {!admin &&
        ["sourcing", "changes_requested", "quoted"].includes(item.stage) && (
          <Card>
            <CardHeader>
              <CardTitle>Supplier quote sheet</CardTitle>
              <p className="text-sm text-muted-foreground">
                Complete every variant for this supplier, then submit the sheet
                before moving to the next supplier.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Popover
                  open={supplierPickerOpen}
                  onOpenChange={setSupplierPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={supplierPickerOpen}
                      className="justify-between font-normal"
                    >
                      {supplierName || "Search or add a supplier"}
                      <ChevronsUpDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[--radix-popover-trigger-width] p-0"
                    align="start"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        value={supplierSearch}
                        onValueChange={setSupplierSearch}
                        placeholder="Search suppliers"
                      />
                      <CommandList>
                        <CommandEmpty>
                          {supplierSearch.trim()
                            ? `\"${supplierSearch.trim()}\" (add new supplier)`
                            : "Type to search suppliers"}
                        </CommandEmpty>
                        <CommandGroup heading="Suppliers">
                          {suppliers
                            .filter((supplier: any) =>
                              supplier.name
                                .toLowerCase()
                                .includes(supplierSearch.toLowerCase()),
                            )
                            .map((supplier: any) => (
                              <CommandItem
                                key={supplier.id}
                                value={supplier.name}
                                onSelect={() => selectSupplier(supplier)}
                              >
                                <Check
                                  className={`mr-2 h-4 w-4 ${supplierId === supplier.id ? "opacity-100" : "opacity-0"}`}
                                />
                                {supplier.name}
                              </CommandItem>
                            ))}
                          {supplierSearch.trim() &&
                            !suppliers.some(
                              (supplier: any) =>
                                supplier.name.toLowerCase() ===
                                supplierSearch.trim().toLowerCase(),
                            ) && (
                              <CommandItem
                                value={`new-${supplierSearch.trim()}`}
                                onSelect={() =>
                                  selectNewSupplierName(supplierSearch)
                                }
                              >
                                {supplierSearch.trim()} (add new supplier)
                              </CommandItem>
                            )}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Input
                  value={paymentTerms}
                  onChange={(event) => setPaymentTerms(event.target.value)}
                  placeholder="Payment terms (optional)"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="w-10 p-2">
                        <Checkbox
                          checked={
                            batchVariantIds.length === item.variants.length
                          }
                          onCheckedChange={(checked) =>
                            setBatchVariantIds(
                              checked
                                ? item.variants.map(
                                    (variant: any) => variant.id,
                                  )
                                : [],
                            )
                          }
                          aria-label="Select all variants"
                        />
                      </th>
                      <th className="p-2">Variant</th>
                      <th className="p-2">Available</th>
                      <th className="p-2">CNY / selling unit</th>
                      <th className="p-2">Pieces / unit</th>
                      <th className="p-2">Carton L x W x H cm</th>
                      <th className="p-2">Pieces / carton</th>
                      <th className="p-2">Market RM / pack</th>
                      <th className="p-2">MOQ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b bg-muted/40 align-middle">
                      <td className="p-2" />
                      <td className="p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">Batch edit</span>
                          <span className="text-xs text-muted-foreground">
                            {batchVariantIds.length} selected
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={!batchVariantIds.length}
                            onClick={applyBatch}
                          >
                            Apply
                          </Button>
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={batch.availability === "available"}
                            onCheckedChange={(checked) =>
                              setBatch((current) => ({
                                ...current,
                                availability: checked
                                  ? "available"
                                  : "unavailable",
                              }))
                            }
                          />
                          <span className="text-xs text-muted-foreground">
                            {batch.availability === "available"
                              ? "Available"
                              : "Unavailable"}
                          </span>
                        </div>
                      </td>
                      <td className="p-2">
                        <Input
                          className="h-8 min-w-20 text-xs"
                          type="number"
                          placeholder="CNY"
                          value={batch.unitPriceRmb}
                          onChange={(event) =>
                            setBatch((current) => ({
                              ...current,
                              unitPriceRmb: event.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          className="h-8 min-w-20 text-xs"
                          type="number"
                          placeholder="Pieces"
                          value={batch.piecesPerSellingUnit}
                          onChange={(event) =>
                            setBatch((current) => ({
                              ...current,
                              piecesPerSellingUnit: event.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Input
                            className="h-8 min-w-14 text-xs"
                            type="number"
                            placeholder="L"
                            value={batch.cartonLengthCm}
                            onChange={(event) =>
                              setBatch((current) => ({
                                ...current,
                                cartonLengthCm: event.target.value,
                              }))
                            }
                          />
                          <Input
                            className="h-8 min-w-14 text-xs"
                            type="number"
                            placeholder="W"
                            value={batch.cartonWidthCm}
                            onChange={(event) =>
                              setBatch((current) => ({
                                ...current,
                                cartonWidthCm: event.target.value,
                              }))
                            }
                          />
                          <Input
                            className="h-8 min-w-14 text-xs"
                            type="number"
                            placeholder="H"
                            value={batch.cartonHeightCm}
                            onChange={(event) =>
                              setBatch((current) => ({
                                ...current,
                                cartonHeightCm: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </td>
                      <td className="p-2">
                        <Input
                          className="h-8 min-w-20 text-xs"
                          type="number"
                          placeholder="Pieces"
                          value={batch.piecesPerCarton}
                          onChange={(event) =>
                            setBatch((current) => ({
                              ...current,
                              piecesPerCarton: event.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Input
                            className="h-8 min-w-16 text-xs"
                            type="number"
                            placeholder="RM"
                            value={batch.marketPriceMyr}
                            onChange={(event) =>
                              setBatch((current) => ({
                                ...current,
                                marketPriceMyr: event.target.value,
                              }))
                            }
                          />
                          <Input
                            className="h-8 min-w-14 text-xs"
                            type="number"
                            placeholder="Pack"
                            value={batch.marketPack}
                            onChange={(event) =>
                              setBatch((current) => ({
                                ...current,
                                marketPack: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </td>
                      <td className="p-2">
                        <Input
                          className="h-8 min-w-16 text-xs"
                          type="number"
                          placeholder="MOQ"
                          value={batch.moq}
                          onChange={(event) =>
                            setBatch((current) => ({
                              ...current,
                              moq: event.target.value,
                            }))
                          }
                        />
                      </td>
                    </tr>
                    {item.variants.map((variant: any) => {
                      const line = lines[variant.id] || emptyLine();
                      return (
                        <tr
                          key={variant.id}
                          className={`border-b align-top ${line.availability === "unavailable" ? "bg-muted/20 text-muted-foreground" : ""}`}
                        >
                          <td className="p-2">
                            <Checkbox
                              checked={batchVariantIds.includes(variant.id)}
                              onCheckedChange={(checked) =>
                                setBatchVariantIds((current) =>
                                  checked
                                    ? [...new Set([...current, variant.id])]
                                    : current.filter((id) => id !== variant.id),
                                )
                              }
                              aria-label={`Select ${label(variant)}`}
                            />
                          </td>
                          <td className="p-2 font-medium">
                            {label(variant)}
                            <div className="text-xs text-muted-foreground">
                              Need {variant.requestedQuantity}
                            </div>
                          </td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={line.availability === "available"}
                                onCheckedChange={(checked) =>
                                  updateLine(
                                    variant.id,
                                    "availability",
                                    checked ? "available" : "unavailable",
                                  )
                                }
                              />
                              <span className="text-xs text-muted-foreground">
                                {line.availability === "available"
                                  ? "Available"
                                  : "Unavailable"}
                              </span>
                            </div>
                          </td>
                          <td className="p-2">
                            <Input
                              disabled={line.availability === "unavailable"}
                              type="number"
                              min="0"
                              value={line.unitPriceRmb}
                              onChange={(event) =>
                                updateLine(
                                  variant.id,
                                  "unitPriceRmb",
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              disabled={line.availability === "unavailable"}
                              type="number"
                              min="1"
                              value={line.piecesPerSellingUnit}
                              onChange={(event) =>
                                updateLine(
                                  variant.id,
                                  "piecesPerSellingUnit",
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td className="p-2">
                            <div className="flex gap-1">
                              <Input
                                value={line.cartonLengthCm}
                                onChange={(event) =>
                                  updateLine(
                                    variant.id,
                                    "cartonLengthCm",
                                    event.target.value,
                                  )
                                }
                              />
                              <Input
                                value={line.cartonWidthCm}
                                onChange={(event) =>
                                  updateLine(
                                    variant.id,
                                    "cartonWidthCm",
                                    event.target.value,
                                  )
                                }
                              />
                              <Input
                                value={line.cartonHeightCm}
                                onChange={(event) =>
                                  updateLine(
                                    variant.id,
                                    "cartonHeightCm",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              value={line.piecesPerCarton}
                              onChange={(event) =>
                                updateLine(
                                  variant.id,
                                  "piecesPerCarton",
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td className="p-2">
                            <div className="flex gap-1">
                              <Input
                                type="number"
                                value={line.marketPriceMyr}
                                onChange={(event) =>
                                  updateLine(
                                    variant.id,
                                    "marketPriceMyr",
                                    event.target.value,
                                  )
                                }
                              />
                              <Input
                                type="number"
                                value={line.marketPack}
                                onChange={(event) =>
                                  updateLine(
                                    variant.id,
                                    "marketPack",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              value={line.moq}
                              onChange={(event) =>
                                updateLine(
                                  variant.id,
                                  "moq",
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Textarea
                value={sheetNotes}
                onChange={(event) => setSheetNotes(event.target.value)}
                placeholder="Supplier-wide notes"
              />
              <div className="flex justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!supplierName.trim()}
                  isLoading={command.isPending}
                  onClick={saveSheet}
                >
                  Save draft
                </Button>
                <Button
                  onClick={submitSheet}
                  disabled={!supplierName.trim()}
                  isLoading={command.isPending}
                >
                  <Send className="h-4 w-4" /> Submit supplier sheet
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      {!admin &&
        ["sourcing", "changes_requested", "quoted"].includes(item.stage) && (
          <Card className="hidden">
            <CardHeader>
              <CardTitle>Batch edit quote sheet</CardTitle>
              <p className="text-sm text-muted-foreground">
                Apply shared supplier values to selected variants. Individual
                values remain editable afterward.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {batchVariantIds.length} variant(s) selected
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Select
                  value={batch.availability || "all"}
                  onValueChange={(value) =>
                    setBatch((current) => ({
                      ...current,
                      availability: value === "all" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Availability" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Keep availability</SelectItem>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="unavailable">Unavailable</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="CNY / selling unit"
                  value={batch.unitPriceRmb}
                  onChange={(event) =>
                    setBatch((current) => ({
                      ...current,
                      unitPriceRmb: event.target.value,
                    }))
                  }
                />
                <Input
                  type="number"
                  placeholder="Pieces / unit"
                  value={batch.piecesPerSellingUnit}
                  onChange={(event) =>
                    setBatch((current) => ({
                      ...current,
                      piecesPerSellingUnit: event.target.value,
                    }))
                  }
                />
                <Input
                  type="number"
                  placeholder="Pieces / carton"
                  value={batch.piecesPerCarton}
                  onChange={(event) =>
                    setBatch((current) => ({
                      ...current,
                      piecesPerCarton: event.target.value,
                    }))
                  }
                />
                <Input
                  type="number"
                  placeholder="MOQ"
                  value={batch.moq}
                  onChange={(event) =>
                    setBatch((current) => ({
                      ...current,
                      moq: event.target.value,
                    }))
                  }
                />
                <Input
                  type="number"
                  placeholder="Market RM / pack"
                  value={batch.marketPriceMyr}
                  onChange={(event) =>
                    setBatch((current) => ({
                      ...current,
                      marketPriceMyr: event.target.value,
                    }))
                  }
                />
                <Input
                  type="number"
                  placeholder="Market pieces / pack"
                  value={batch.marketPack}
                  onChange={(event) =>
                    setBatch((current) => ({
                      ...current,
                      marketPack: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  type="number"
                  placeholder="Carton length cm"
                  value={batch.cartonLengthCm}
                  onChange={(event) =>
                    setBatch((current) => ({
                      ...current,
                      cartonLengthCm: event.target.value,
                    }))
                  }
                />
                <Input
                  type="number"
                  placeholder="Carton width cm"
                  value={batch.cartonWidthCm}
                  onChange={(event) =>
                    setBatch((current) => ({
                      ...current,
                      cartonWidthCm: event.target.value,
                    }))
                  }
                />
                <Input
                  type="number"
                  placeholder="Carton height cm"
                  value={batch.cartonHeightCm}
                  onChange={(event) =>
                    setBatch((current) => ({
                      ...current,
                      cartonHeightCm: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!batchVariantIds.length}
                  onClick={applyBatch}
                >
                  Apply to selected variants
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      {!admin &&
        ["sourcing", "changes_requested", "quoted"].includes(item.stage) && (
          <div className="hidden justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={!supplierName.trim()}
              isLoading={command.isPending}
              onClick={saveSheet}
            >
              Save supplier sheet draft
            </Button>
          </div>
        )}
      {admin && (
        <div
          id="variant-offers"
          className="grid gap-5 scroll-mt-4 lg:grid-cols-[260px_minmax(0,1fr)]"
        >
          <Card>
            <CardHeader>
              <CardTitle>Choose variant</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {item.variants.map((variant: any) => (
                <button
                  type="button"
                  key={variant.id}
                  onClick={() => setActiveVariantId(variant.id)}
                  className={`w-full rounded-lg border p-3 text-left text-sm ${activeVariantId === variant.id ? "border-sky-600 bg-sky-50" : ""}`}
                >
                  <span className="font-medium">{label(variant)}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {selected[variant.id]
                      ? "Offer selected"
                      : skipped[variant.id]
                        ? "Skipped"
                        : "Needs decision"}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                {activeVariant ? label(activeVariant) : "Variant offers"}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Select only offers that pass the canonical landed-cost model. A
                missing freight, market, or pack input needs correction first.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {offers.length ? (
                offers.map((offer: any) => {
                  const evaluation = variantViability(offer, costConfig);
                  const result = evaluation.result;
                  const chosen = selected[activeVariantId] === offer.id;
                  return (
                    <div
                      key={offer.id}
                      className={`rounded-lg border p-4 ${chosen ? "border-sky-600 ring-1 ring-sky-600" : ""}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">
                            {offer.quote.supplierName}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            CNY {offer.unitPriceRmb ?? "-"} per selling unit ·
                            MOQ {offer.moq || "-"} ·{" "}
                            {offer.leadTimeDays ||
                              offer.quote.leadTimeDays ||
                              "-"}{" "}
                            days
                          </p>
                        </div>
                        <Badge className={statusStyle[evaluation.status]}>
                          {evaluation.status.replaceAll("_", " ")}
                        </Badge>
                      </div>
                      {result && (
                        <div className="mt-3 rounded bg-muted/50 p-3 text-sm">
                          <span>
                            Product RM {result.productCostPerPiece.toFixed(2)} +
                            Shipping RM {result.freightPerPiece.toFixed(2)} ={" "}
                            <b>Landed RM {result.landed.toFixed(2)}</b>
                          </span>
                          <span className="ml-3">
                            Min viable RM{" "}
                            {result.minViablePrice?.toFixed(2) || "-"}
                          </span>
                          {result.marketPerPiece && (
                            <span className="ml-3">
                              Market RM {result.marketPerPiece.toFixed(2)} ·
                              Margin {result.marginPercent?.toFixed(1)}%
                            </span>
                          )}{" "}
                          {result.flags.length > 0 && (
                            <p className="mt-2 flex items-center gap-1 text-amber-700">
                              <CircleAlert className="h-4 w-4" />
                              {result.flags.join(", ")}
                            </p>
                          )}
                        </div>
                      )}
                      <Button
                        className="mt-3"
                        size="sm"
                        disabled={evaluation.status !== "pass"}
                        variant={chosen ? "default" : "outline"}
                        onClick={() => {
                          setSelected((current) => ({
                            ...current,
                            [activeVariantId]: offer.id,
                          }));
                          setSkipped((current) => {
                            const next = { ...current };
                            delete next[activeVariantId];
                            return next;
                          });
                        }}
                      >
                        <Check className="h-4 w-4" />{" "}
                        {chosen ? "Selected" : "Select offer"}
                      </Button>
                    </div>
                  );
                })
              ) : (
                <p className="text-muted-foreground">
                  No submitted supplier offer covers this variant yet.
                </p>
              )}
              <div className="border-t pt-4">
                <p className="text-sm font-medium">Or skip this variant</p>
                <Textarea
                  className="mt-2"
                  value={skipped[activeVariantId] || ""}
                  onChange={(event) => {
                    const reason = event.target.value;
                    setSkipped((current) => ({
                      ...current,
                      [activeVariantId]: reason,
                    }));
                    if (reason)
                      setSelected((current) => {
                        const next = { ...current };
                        delete next[activeVariantId];
                        return next;
                      });
                  }}
                  placeholder="Why this variant is not being ordered"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {admin && item.stage === "quoted" && (
        <Button onClick={confirmSelections} isLoading={command.isPending}>
          <Check className="h-4 w-4" /> Confirm variant decisions
        </Button>
      )}
      {admin && item.stage === "approved" && (
        <Card>
          <CardHeader>
            <CardTitle>Final supplier order review</CardTitle>
            <p className="text-sm text-muted-foreground">
              One multi-line purchase order will be created for each supplier
              below.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(selectedBySupplier).map(
              ([supplier, supplierLines]) => (
                <div key={supplier} className="rounded-lg border p-3">
                  <p className="font-medium">{supplier}</p>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {(supplierLines as any[]).map((line: any) => (
                      <li key={line.id}>
                        {label(line)} ·{" "}
                        {Math.max(line.requestedQuantity, line.moq || 0)} units
                        · CNY {line.unitPriceRmb}
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
            {item.variants.filter(
              (variant: any) => variant.selection?.status === "skipped",
            ).length > 0 && (
              <p className="text-sm text-muted-foreground">
                {
                  item.variants.filter(
                    (variant: any) => variant.selection?.status === "skipped",
                  ).length
                }{" "}
                variant(s) deliberately skipped.
              </p>
            )}
            <Button
              onClick={() =>
                command.mutate({
                  id: item.id,
                  action: "create_variant_orders",
                  version: item.version,
                })
              }
              isLoading={command.isPending}
            >
              <PackagePlus className="h-4 w-4" /> Create supplier orders
            </Button>
          </CardContent>
        </Card>
      )}
      {item.orders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Purchase orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {item.orders.map((order: any) => (
              <Link
                key={order.id}
                className="block rounded border p-3 hover:bg-muted/50"
                href={`${basePath.includes("/admin") ? "/admin/purchase-orders" : "/sourcing/purchase-orders"}/${order.purchaseOrderId}`}
              >
                {order.purchaseOrder?.poNumber} ·{" "}
                {order.purchaseOrder?.supplier?.name} ·{" "}
                {order.purchaseOrder?.items?.length} variant lines
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Comments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            placeholder="Write a comment for the sourcing team."
            maxLength={4000}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!commentBody.trim()}
              isLoading={comment.isPending}
              onClick={async () => {
                await comment.mutateAsync({ id: item.id, body: commentBody });
                setCommentBody("");
              }}
            >
              <Send className="h-4 w-4" /> Send
            </Button>
          </div>
          <div className="space-y-2 border-t pt-3">
            {item.comments?.length ? (
              item.comments.map((entry: any) => (
                <div key={entry.id} className="border-b pb-3 last:border-0">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {entry.author?.name ||
                        entry.author?.email ||
                        "Unknown user"}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {entry.body}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
