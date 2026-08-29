"use client";
/* eslint-disable @next/next/no-img-element -- sourcing attachments require authenticated URLs. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  CircleAlert,
  FileText,
  ImagePlus,
  MoreHorizontal,
  Send,
  Trash2,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useCreateSourcingComment,
  useSourcingCase,
  useSourcingCommand,
  useSourcingSuppliers,
  useUploadSourcingAttachment,
  useDeleteSourcingAttachment,
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
  cartonWeightKg: string;
  piecesPerCarton: string;
  moq: string;
  leadTimeDays: string;
  notes: string;
};
type MarketBenchmark = {
  marketPriceMyr?: number;
  marketPack?: number;
};
type ProposalDraft = SheetLine & {
  clientKey: string;
  caseVariantId?: string;
  size: string;
  material: string;
  colour: string;
  customLabel: string;
};
const emptyLine = (): SheetLine => ({
  availability: "available",
  unitPriceRmb: "",
  piecesPerSellingUnit: "1",
  cartonLengthCm: "",
  cartonWidthCm: "",
  cartonHeightCm: "",
  cartonWeightKg: "",
  piecesPerCarton: "",
  moq: "",
  leadTimeDays: "",
  notes: "",
});
const asNumber = (value: string) => (value === "" ? undefined : Number(value));
const label = (variant: any) =>
  variant.customLabel ||
  [variant.size, variant.material, variant.colour]
    .filter(Boolean)
    .join(" / ") ||
  "Standard";
const statusStyle: Record<string, string> = {
  pass: "bg-emerald-100 text-emerald-800",
  fail: "bg-red-100 text-red-800",
  needs_data: "bg-amber-100 text-amber-800",
  market_unchecked: "bg-amber-100 text-amber-800",
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
  const uploadAttachment = useUploadSourcingAttachment();
  const deleteAttachment = useDeleteSourcingAttachment();
  const { data: suppliers = [] } = useSourcingSuppliers(
    item?.workspaceId || "",
  );
  const admin = basePath.startsWith("/admin");
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const sheetSelectionInitialized = useRef(false);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [sheetNotes, setSheetNotes] = useState("");
  const [lines, setLines] = useState<Record<string, SheetLine>>({});
  const [proposals, setProposals] = useState<ProposalDraft[]>([]);
  const [proposalImages, setProposalImages] = useState<
    Record<string, File | undefined>
  >({});
  const [proposalImagePreviews, setProposalImagePreviews] = useState<
    Record<string, string>
  >({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [activeVariantId, setActiveVariantId] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, string>>({});
  const [skipDialogVariantId, setSkipDialogVariantId] = useState<string | null>(
    null,
  );
  const [skipReason, setSkipReason] = useState("");
  const [changeDialog, setChangeDialog] = useState<{
    offer: any;
    variantId: string;
  } | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [selectionDialog, setSelectionDialog] = useState<{
    offer: any;
    variant: any;
    market: MarketBenchmark;
  } | null>(null);
  const [selectionQuantity, setSelectionQuantity] = useState("");
  const [confirmDecisionsOpen, setConfirmDecisionsOpen] = useState(false);
  const [orderQuantities, setOrderQuantities] = useState<
    Record<string, string>
  >({});
  const [bulkOrderQuantity, setBulkOrderQuantity] = useState("");
  const [marketBenchmarks, setMarketBenchmarks] = useState<
    Record<string, MarketBenchmark>
  >({});
  const [commentBody, setCommentBody] = useState("");
  const [batchVariantIds, setBatchVariantIds] = useState<string[]>([]);
  const [batch, setBatch] = useState({
    availability: "available",
    unitPriceRmb: "",
    piecesPerSellingUnit: "",
    cartonLengthCm: "",
    cartonWidthCm: "",
    cartonHeightCm: "",
    cartonWeightKg: "",
    piecesPerCarton: "",
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
    setMarketBenchmarks(
      Object.fromEntries(
        item.variants.map((variant: any) => [
          variant.id,
          {
            marketPriceMyr: variant.marketPriceMyr ?? undefined,
            marketPack: variant.marketPack ?? 1,
          },
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
    ["submitted", "changes_requested"].includes(quote.status)
      ? quote.lines.map((line: any) => ({ ...line, quote }))
      : [],
  );
  const decisionsLocked = item.stage !== "quoted";
  const quoteSheetLocked = ![
    "sourcing",
    "changes_requested",
    "quoted",
  ].includes(item.stage);
  const supplierSheets = Object.values(
    item.quotes.reduce((groups: Record<string, any>, quote: any) => {
      const key = quote.quoteGroupId || quote.id;
      if (!groups[key] || groups[key].revision < quote.revision)
        groups[key] = quote;
      return groups;
    }, {}),
  ).filter((quote: any) =>
    ["draft", "submitted", "changes_requested"].includes(quote.status),
  ) as any[];
  const quoteRequestedVariants = item.variants.filter(
    (variant: any) =>
      variant.origin === "admin" && variant.requestQuote !== false,
  );
  const sheetsNeedingChanges = supplierSheets.filter(
    (sheet: any) => sheet.status === "changes_requested",
  );
  const displayStage =
    item.stage === "quoted" && sheetsNeedingChanges.length
      ? "changes_requested"
      : item.stage;
  const activeCorrection = item.events?.find(
    (event: any) =>
      event.type === "variant_quote_changes_requested" &&
      event.payload?.quoteId === activeSheetId,
  );
  const activeVariant = item.variants.find(
    (variant: any) => variant.id === activeVariantId,
  );
  const activeMarket = {
    marketPriceMyr: activeVariant?.marketPriceMyr ?? undefined,
    marketPack: activeVariant?.marketPack ?? 1,
  };
  const offers = submittedLines.filter(
    (line: any) =>
      line.caseVariantId === activeVariantId &&
      line.availability === "available",
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
    (attachment: any) => !attachment.quoteId && !attachment.caseVariantId,
  );
  const variantAttachments = (item.attachments || []).filter(
    (attachment: any) => attachment.caseVariantId,
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
  const timelineIndex = getSourcingTimelineIndex(displayStage, viewer);
  const currentTimelineLabel =
    timelineSteps.find((step) => step.id === displayStage)?.label ||
    displayStage;
  const action = admin
    ? displayStage === "quoted"
      ? [
        "Your next step",
        "Review variant offers",
        "Choose one passed offer or explicitly skip each requested variant.",
      ]
      : displayStage === "approved"
        ? [
          "Your next step",
          "Create supplier orders",
          "Review the supplier groups and create the purchase orders.",
        ]
        : displayStage === "sourcing"
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
    : displayStage === "changes_requested"
      ? [
        "Changes required",
        sheetsNeedingChanges.length === 1
          ? "Fix and resubmit 1 quote sheet"
          : `Fix and resubmit ${sheetsNeedingChanges.length} quote sheets`,
        "Open the supplier sheet marked Needs correction to review the requested changes.",
      ]
      : displayStage === "sourcing"
        ? [
          "Your next step",
          "Complete a supplier quote sheet",
          "Record every requested variant for this supplier, then submit before moving on.",
        ]
        : displayStage === "quoted"
          ? [
            "Current progress",
            "Waiting for admin review",
            "The admin will choose viable variant offers or request changes.",
          ]
          : displayStage === "ordered"
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
  const sourcerAction = !admin
    ? ["sourcing", "changes_requested", "quoted", "approved"].includes(
      displayStage,
    )
      ? {
        href: "#supplier-quote-sheets",
        label:
          displayStage === "changes_requested"
            ? "Fix quote sheet"
            : displayStage === "quoted"
              ? "View quote sheets"
              : "Open quote sheets",
      }
      : ["order_pending", "ordered", "shipping", "received"].includes(
        displayStage,
      )
        ? {
          href: "#purchase-orders",
          label:
            displayStage === "order_pending"
              ? "Place supplier orders"
              : displayStage === "ordered"
                ? "Arrange shipment"
                : "View purchase orders",
        }
        : null
    : null;
  const sheetPayload = () => ({
    supplierId: supplierId || null,
    supplierName,
    paymentTerms: paymentTerms || null,
    notes: sheetNotes || null,
    lines: item.variants
      .filter(
        (variant: any) =>
          variant.requestQuote !== false && variant.origin === "admin",
      )
      .map((variant: any) => ({
        caseVariantId: variant.id,
        ...Object.fromEntries(
          Object.entries(lines[variant.id] || emptyLine()).map(
            ([key, value]) => [
              key,
              ["availability", "notes"].includes(key)
                ? value
                : asNumber(value as string),
            ],
          ),
        ),
      })),
    proposals: proposals.map(
      ({ clientKey: _clientKey, caseVariantId, ...proposal }) => ({
        ...Object.fromEntries(
          Object.entries(proposal).map(([key, value]) => [
            key,
            [
              "availability",
              "notes",
              "size",
              "material",
              "colour",
              "customLabel",
            ].includes(key)
              ? value
              : asNumber(value as string),
          ]),
        ),
        ...(caseVariantId ? { caseVariantId } : {}),
      }),
    ),
  });
  const missingQuoteFields = (line: SheetLine) =>
    [
      !line.unitPriceRmb && "unitPriceRmb",
      !line.piecesPerSellingUnit && "piecesPerSellingUnit",
      !line.cartonWeightKg && "cartonWeightKg",
      !line.cartonLengthCm && "cartonLengthCm",
      !line.cartonWidthCm && "cartonWidthCm",
      !line.cartonHeightCm && "cartonHeightCm",
      !line.piecesPerCarton && "piecesPerCarton",
    ].filter(Boolean) as (keyof SheetLine)[];
  const incompleteQuoteVariantIds = item.variants
    .filter(
      (variant: any) =>
        variant.requestQuote !== false && variant.origin === "admin",
    )
    .filter((variant: any) => {
      const line = lines[variant.id] || emptyLine();
      return (
        line.availability === "available" && missingQuoteFields(line).length > 0
      );
    })
    .map((variant: any) => variant.id);
  const submitBlocker = !supplierName.trim()
    ? "Choose a supplier before submitting."
    : incompleteQuoteVariantIds.length
      ? `${incompleteQuoteVariantIds.length} available variant${incompleteQuoteVariantIds.length === 1 ? " is" : "s are"} missing required quote or carton information.`
      : "";
  const quoteFieldClass = (
    variantId: string,
    line: SheetLine,
    field: keyof SheetLine,
  ) =>
    submitAttempted &&
      incompleteQuoteVariantIds.includes(variantId) &&
      missingQuoteFields(line).includes(field)
      ? "border-destructive focus-visible:ring-destructive"
      : "";
  const uploadProposalImages = async (result: any) => {
    const ids: string[] = result?.proposalVariantIds || [];
    await Promise.all(
      proposals.map((proposal, index) => {
        const file = proposalImages[proposal.clientKey];
        const caseVariantId = proposal.caseVariantId || ids[index];
        return file && caseVariantId
          ? uploadAttachment.mutateAsync({ id: item.id, file, caseVariantId })
          : Promise.resolve();
      }),
    );
  };
  const submitSheet = async () => {
    setSubmitAttempted(true);
    if (submitBlocker) return;
    const result = await command.mutateAsync({
      id: item.id,
      action: "submit_variant_quote",
      version: item.version,
      quoteId: activeSheetId || undefined,
      quoteSheet: sheetPayload(),
    });
    await uploadProposalImages(result);
  };
  const saveSheet = async () => {
    const result = await command.mutateAsync({
      id: item.id,
      action: "save_variant_quote",
      version: item.version,
      quoteId: activeSheetId || undefined,
      quoteSheet: sheetPayload(),
    });
    await uploadProposalImages(result);
  };
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
                cartonWeightKg: line.cartonWeightKg?.toString() || "",
                piecesPerCarton: line.piecesPerCarton?.toString() || "",
                moq: line.moq?.toString() || "",
                leadTimeDays: line.leadTimeDays?.toString() || "",
                notes: line.notes || "",
              }
              : emptyLine(),
          ];
        }),
      ),
    );
    setProposals(
      item.variants
        .filter(
          (variant: any) =>
            variant.origin === "sourcer" &&
            variant.proposedQuoteGroupId === sheet.quoteGroupId,
        )
        .map((variant: any) => {
          const line = sheet.lines.find(
            (entry: any) => entry.caseVariantId === variant.id,
          );
          return {
            clientKey: variant.id,
            caseVariantId: variant.id,
            size: variant.size || "",
            material: variant.material || "",
            colour: variant.colour || "",
            customLabel: variant.customLabel || "",
            availability: line?.availability || "available",
            unitPriceRmb: line?.unitPriceRmb?.toString() || "",
            piecesPerSellingUnit: line?.piecesPerSellingUnit?.toString() || "1",
            cartonLengthCm: line?.cartonLengthCm?.toString() || "",
            cartonWidthCm: line?.cartonWidthCm?.toString() || "",
            cartonHeightCm: line?.cartonHeightCm?.toString() || "",
            cartonWeightKg: line?.cartonWeightKg?.toString() || "",
            piecesPerCarton: line?.piecesPerCarton?.toString() || "",
            moq: line?.moq?.toString() || "",
            leadTimeDays: line?.leadTimeDays?.toString() || "",
            notes: line?.notes || "",
          } as ProposalDraft;
        }),
    );
  };
  const defaultQuoteSheet =
    supplierSheets.find((sheet: any) => sheet.status === "changes_requested") ||
    supplierSheets.find((sheet: any) => sheet.status === "submitted");
  useEffect(() => {
    if (sheetSelectionInitialized.current || !defaultQuoteSheet) return;
    sheetSelectionInitialized.current = true;
    selectSheet(defaultQuoteSheet);
  }, [defaultQuoteSheet?.id]);
  const startNewQuoteSheet = () => {
    setActiveSheetId(null);
    setSupplierId("");
    setSupplierName("");
    setPaymentTerms("");
    setSheetNotes("");
    setLines(
      Object.fromEntries(
        item.variants.map((variant: any) => [variant.id, emptyLine()]),
      ),
    );
    setProposals([]);
    setProposalImages({});
    setProposalImagePreviews({});
    setSubmitAttempted(false);
    setSupplierPickerOpen(true);
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
    }
    setSupplierSearch("");
    setSupplierPickerOpen(false);
  };
  const selectNewSupplierName = (name: string) => {
    setActiveSheetId(null);
    setSupplierId("");
    setSupplierName(name.trim());
    setSupplierSearch("");
    setSupplierPickerOpen(false);
  };
  const allQuoteLineIds = [
    ...item.variants
      .filter(
        (variant: any) =>
          variant.requestQuote !== false && variant.origin === "admin",
      )
      .map((variant: any) => variant.id),
    ...proposals.map((proposal) => proposal.clientKey),
  ];
  const applyBatch = (targetIds: string[] = batchVariantIds) => {
    setLines((current) => ({
      ...current,
      ...Object.fromEntries(
        item.variants
          .filter((variant: any) => targetIds.includes(variant.id))
          .map((variant: any) => {
            const line = { ...(current[variant.id] || emptyLine()) };
            for (const [field, value] of Object.entries(batch))
              if (value !== "") (line as any)[field] = value;
            return [variant.id, line];
          }),
      ),
    }));
    setProposals((current) =>
      current.map((proposal) => {
        if (!targetIds.includes(proposal.clientKey)) return proposal;
        const next = { ...proposal };
        for (const [field, value] of Object.entries(batch))
          if (value !== "") (next as any)[field] = value;
        return next;
      }),
    );
  };
  const confirmSelections = () =>
    command.mutate(
      {
        id: item.id,
        action: "confirm_variant_selection",
        version: item.version,
        selections: item.variants.map((variant: any) =>
          selected[variant.id]
            ? {
              caseVariantId: variant.id,
              quoteLineId: selected[variant.id],
              status: "selected",
              ...marketBenchmarks[variant.id],
            }
            : {
              caseVariantId: variant.id,
              status: "skipped",
              skipReason: skipped[variant.id] || "No viable offer selected",
              ...marketBenchmarks[variant.id],
            },
        ),
      },
      {
        onSuccess: () => {
          // The case stage changes as part of this mutation. Use a full navigation
          // so the approved detail never flashes before the order review loads.
          window.location.assign(`${basePath}/${item.id}/review`);
        },
      },
    );
  const undecidedVariants = item.variants.filter(
    (variant: any) =>
      variant.requestQuote !== false &&
      !selected[variant.id] &&
      !skipped[variant.id]?.trim(),
  );
  const updateLine = (
    variantId: string,
    field: keyof SheetLine,
    value: string,
  ) =>
    setLines((current) => ({
      ...current,
      [variantId]: { ...(current[variantId] || emptyLine()), [field]: value },
    }));
  const updateProposal = (index: number, patch: Partial<ProposalDraft>) =>
    setProposals((current) =>
      current.map((proposal, position) =>
        position === index ? { ...proposal, ...patch } : proposal,
      ),
    );
  const addProposal = () =>
    setProposals((current) => [
      ...current,
      {
        clientKey: crypto.randomUUID(),
        size: "",
        material: "",
        colour: "",
        customLabel: "",
        availability: "available",
        unitPriceRmb: "",
        piecesPerSellingUnit: "1",
        cartonLengthCm: "",
        cartonWidthCm: "",
        cartonHeightCm: "",
        cartonWeightKg: "",
        piecesPerCarton: "",
        moq: "",
        leadTimeDays: "",
        notes: "",
      },
    ]);
  const updateMarketBenchmark = (
    variantId: string,
    update: Partial<MarketBenchmark>,
  ) =>
    setMarketBenchmarks((current) => ({
      ...current,
      [variantId]: {
        marketPriceMyr: current[variantId]?.marketPriceMyr,
        marketPack: current[variantId]?.marketPack ?? 1,
        ...update,
      },
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
        <Badge>{displayStage.replaceAll("_", " ")}</Badge>
      </div>
      <Card
        className={
          !admin && displayStage === "changes_requested"
            ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
            : displayStage === "quoted" || displayStage === "approved"
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
          {admin && displayStage === "quoted" && (
            <Button asChild>
              <a href="#variant-offers">Review variant offers</a>
            </Button>
          )}
          {admin && ["approved", "order_pending"].includes(item.stage) && (
            <Button asChild>
              <Link href={`${basePath}/${item.id}/review`}>
                Create supplier orders
              </Link>
            </Button>
          )}
          {sourcerAction && (
            <Button asChild>
              <a
                href={sourcerAction.href}
                onClick={() => {
                  if (
                    displayStage === "changes_requested" &&
                    sheetsNeedingChanges[0]
                  )
                    selectSheet(sheetsNeedingChanges[0]);
                }}
              >
                {sourcerAction.label}
              </a>
            </Button>
          )}
          {!admin &&
            displayStage === "changes_requested" &&
            sheetsNeedingChanges[0] && (
              <Button asChild variant="destructive">
                <a
                  href="#supplier-quote-sheets"
                  onClick={() => selectSheet(sheetsNeedingChanges[0])}
                >
                  Fix quote sheet
                </a>
              </Button>
            )}
        </CardContent>
      </Card>
      {/* <Card> */}
      {/*   <CardHeader> */}
      {/*     <CardTitle>Request summary</CardTitle> */}
      {/*   </CardHeader> */}
      {/*   <CardContent className="grid gap-3 text-sm sm:grid-cols-2"> */}
      {/*     <p> */}
      {/*       <b>Variants:</b> {item.variants.length} */}
      {/*     </p> */}
      {/*     <p> */}
      {/*       <b>Requested units:</b> {totalUnits} */}
      {/*     </p> */}
      {/*     <p> */}
      {/*       <b>Assignee:</b>{" "} */}
      {/*       {item.assignee?.name || item.assignee?.email || "Unassigned"} */}
      {/*     </p> */}
      {/*     <p> */}
      {/*       <b>Reference:</b>{" "} */}
      {/*       {item.referenceUrl ? ( */}
      {/*         <a */}
      {/*           className="text-sky-600 underline" */}
      {/*           href={item.referenceUrl} */}
      {/*           target="_blank" */}
      {/*           rel="noreferrer" */}
      {/*         > */}
      {/*           Open link */}
      {/*         </a> */}
      {/*       ) : ( */}
      {/*         "None" */}
      {/*       )} */}
      {/*     </p> */}
      {/*     <p className="sm:col-span-2"> */}
      {/*       <b>Specifications:</b>{" "} */}
      {/*       {item.specifications || item.description || "None"} */}
      {/*     </p> */}
      {/*     <p className="sm:col-span-2"> */}
      {/*       <b>Notes:</b> {item.notes || "None"} */}
      {/*     </p> */}
      {/*   </CardContent> */}
      {/* </Card> */}
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
      {!admin && (
        <Card id="supplier-quote-sheets">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Supplier quote sheets</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select a supplier sheet to continue editing it, or add another
                  supplier.
                </p>
              </div>
              <Button
                type="button"
                onClick={startNewQuoteSheet}
                disabled={quoteSheetLocked}
              >
                Add new quote sheet
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {supplierSheets.length ? (
              supplierSheets.map((sheet: any) => (
                <button
                  type="button"
                  key={sheet.id}
                  onClick={() => selectSheet(sheet)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${sheet.status === "changes_requested" ? "border-red-500 bg-red-50 hover:bg-red-100" : activeSheetId === sheet.id ? "border-sky-600 bg-sky-50" : "hover:bg-muted/50"}`}
                >
                  <span className="block font-medium">
                    {sheet.supplierName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {sheet.status === "changes_requested"
                      ? "Needs correction"
                      : sheet.status === "submitted"
                        ? "Submitted"
                        : "Draft"}{" "}
                    ·{" "}
                    {
                      sheet.lines.filter(
                        (line: any) =>
                          line.availability === "available" &&
                          quoteRequestedVariants.some(
                            (variant: any) => variant.id === line.caseVariantId,
                          ),
                      ).length
                    }
                    /{quoteRequestedVariants.length} available
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
        [
          "sourcing",
          "changes_requested",
          "quoted",
          "order_pending",
          "ordered",
          "shipping",
          "received",
        ].includes(item.stage) && (
          <Card>
            <CardHeader>
              <CardTitle>Supplier quote sheet</CardTitle>
              <p className="text-sm text-muted-foreground">
                Complete every variant for this supplier, then submit the sheet
                before moving to the next supplier.
              </p>
              {quoteSheetLocked && (
                <p className="text-sm text-muted-foreground">
                  Submitted quote sheets are read-only after purchase orders are
                  created.
                </p>
              )}
            </CardHeader>
            <CardContent className="min-w-0 space-y-4 overflow-hidden">
              <fieldset
                disabled={quoteSheetLocked}
                className="min-w-0 space-y-4"
              >
                {activeCorrection && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-medium">Missing information requested</p>
                    <p className="mt-1">
                      Update the requested variants, then resubmit this supplier
                      sheet.
                    </p>
                    <ul className="mt-2 list-disc pl-5">
                      {(activeCorrection.payload.issues || []).map(
                        (issue: any) => (
                          <li key={issue.variantId}>
                            {issue.variant}: {issue.fields.join(", ")}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
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
                        className={`justify-between font-normal ${
                          !supplierName.trim()
                            ? "border-red-400 bg-red-50 text-amber-950 hover:bg-red-50"
                            : ""
                        }`}
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
                {submitBlocker && !quoteSheetLocked && (
                  <div
                    className={`rounded-md border px-3 py-2 text-sm ${
                      !supplierName.trim()
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-sky-300 bg-sky-50 text-sky-900"
                    }`}
                    role="status"
                  >
                    <span className="font-medium">Before submitting:</span>{" "}
                    {submitBlocker}
                  </div>
                )}
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[1300px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="w-10 p-2">
                          <Checkbox
                            checked={allQuoteLineIds.every((id) =>
                              batchVariantIds.includes(id),
                            )}
                            onCheckedChange={(checked) =>
                              setBatchVariantIds(
                                checked ? [...allQuoteLineIds] : [],
                              )
                            }
                            aria-label="Select all variants"
                          />
                        </th>
                        <th className="p-2">Variant</th>
                        <th className="p-2">Marketplace</th>
                        <th className="p-2">Remarks</th>
                        <th className="p-2">Available</th>
                        <th className="p-2">CNY / selling unit</th>
                        <th className="p-2">Carton weight</th>
                        <th className="p-2">Pieces / unit</th>
                        <th className="p-2">Carton L x W x H cm</th>
                        <th className="p-2">Pieces / carton</th>
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
                              onClick={() => applyBatch()}
                            >
                              Apply
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8"
                              disabled={!allQuoteLineIds.length}
                              onClick={() => applyBatch(allQuoteLineIds)}
                            >
                              Apply to all
                            </Button>
                          </div>
                        </td>
                        <td className="p-2" />
                        <td className="p-2" />
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
                          <div className="flex items-center">
                            <Input
                              className="h-8 min-w-20 text-xs"
                              type="number"
                              placeholder="kg"
                              value={batch.cartonWeightKg}
                              onChange={(event) =>
                                setBatch((current) => ({
                                  ...current,
                                  cartonWeightKg: event.target.value,
                                }))
                              }
                            />
                            <span className="-ml-7 text-xs text-muted-foreground">
                              kg
                            </span>
                          </div>
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
                      {item.variants
                        .filter(
                          (variant: any) =>
                            variant.requestQuote !== false &&
                            variant.origin === "admin",
                        )
                        .map((variant: any) => {
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
                                        : current.filter(
                                          (id) => id !== variant.id,
                                        ),
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
                                {variantAttachments.find(
                                  (attachment: any) =>
                                    attachment.caseVariantId === variant.id &&
                                    attachment.mimeType?.startsWith("image/"),
                                ) && (
                                    <a
                                      href={
                                        variantAttachments.find(
                                          (attachment: any) =>
                                            attachment.caseVariantId ===
                                            variant.id &&
                                            attachment.mimeType?.startsWith(
                                              "image/",
                                            ),
                                        )!.url
                                      }
                                      target="_blank"
                                      rel="noreferrer"
                                      title="Open image"
                                    >
                                      <img
                                        className="mt-2 h-12 w-12 rounded border object-cover"
                                        src={
                                          variantAttachments.find(
                                            (attachment: any) =>
                                              attachment.caseVariantId ===
                                              variant.id &&
                                              attachment.mimeType?.startsWith(
                                                "image/",
                                              ),
                                          )!.url
                                        }
                                        alt={label(variant)}
                                      />
                                    </a>
                                  )}
                              </td>
                              <td className="p-2">
                                {variant.productUrl ? (
                                  <a
                                    className="text-sky-600 underline"
                                    href={variant.productUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open link
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground">
                                    -
                                  </span>
                                )}
                              </td>
                              <td className="max-w-40 p-2 text-xs text-muted-foreground">
                                {variant.remarks || "-"}
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
                                  className={quoteFieldClass(
                                    variant.id,
                                    line,
                                    "unitPriceRmb",
                                  )}
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
                                <div className="flex items-center">
                                  <Input
                                    className={quoteFieldClass(
                                      variant.id,
                                      line,
                                      "cartonWeightKg",
                                    )}
                                    disabled={
                                      line.availability === "unavailable"
                                    }
                                    type="number"
                                    min="0"
                                    value={line.cartonWeightKg}
                                    onChange={(event) =>
                                      updateLine(
                                        variant.id,
                                        "cartonWeightKg",
                                        event.target.value,
                                      )
                                    }
                                  />
                                  <span className="-ml-7 text-xs text-muted-foreground">
                                    kg
                                  </span>
                                </div>
                              </td>
                              <td className="p-2">
                                <Input
                                  className={quoteFieldClass(
                                    variant.id,
                                    line,
                                    "piecesPerSellingUnit",
                                  )}
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
                                    className={quoteFieldClass(
                                      variant.id,
                                      line,
                                      "cartonLengthCm",
                                    )}
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
                                    className={quoteFieldClass(
                                      variant.id,
                                      line,
                                      "cartonWidthCm",
                                    )}
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
                                    className={quoteFieldClass(
                                      variant.id,
                                      line,
                                      "cartonHeightCm",
                                    )}
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
                                  className={quoteFieldClass(
                                    variant.id,
                                    line,
                                    "piecesPerCarton",
                                  )}
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
                      {proposals.map((proposal, index) => (
                        <tr
                          key={proposal.clientKey}
                          className="border-b align-top"
                        >
                          <td className="p-2">
                            <Checkbox
                              checked={batchVariantIds.includes(
                                proposal.clientKey,
                              )}
                              onCheckedChange={(checked) =>
                                setBatchVariantIds((current) =>
                                  checked
                                    ? [
                                      ...new Set([
                                        ...current,
                                        proposal.clientKey,
                                      ]),
                                    ]
                                    : current.filter(
                                      (id) => id !== proposal.clientKey,
                                    ),
                                )
                              }
                              aria-label={`Select ${proposal.customLabel || "supplier proposal"}`}
                            />
                            <Button
                              className="mt-2 text-destructive"
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                setProposals((current) =>
                                  current.filter(
                                    (_, position) => position !== index,
                                  ),
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                          <td className="p-2">
                            <Input
                              placeholder="Variant name"
                              value={proposal.customLabel}
                              onChange={(event) =>
                                updateProposal(index, {
                                  customLabel: event.target.value,
                                })
                              }
                            />
                            <label className="mt-2 flex h-12 w-12 cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed bg-background">
                              {proposalImagePreviews[proposal.clientKey] ? (
                                <img
                                  className="h-full w-full object-cover"
                                  src={
                                    proposalImagePreviews[proposal.clientKey]
                                  }
                                  alt={
                                    proposal.customLabel || "Supplier proposal"
                                  }
                                />
                              ) : proposal.caseVariantId &&
                                variantAttachments.find(
                                  (attachment: any) =>
                                    attachment.caseVariantId ===
                                    proposal.caseVariantId &&
                                    attachment.mimeType?.startsWith("image/"),
                                ) ? (
                                <img
                                  className="h-full w-full object-cover"
                                  src={
                                    variantAttachments.find(
                                      (attachment: any) =>
                                        attachment.caseVariantId ===
                                        proposal.caseVariantId &&
                                        attachment.mimeType?.startsWith(
                                          "image/",
                                        ),
                                    )!.url
                                  }
                                  alt={
                                    proposal.customLabel || "Supplier proposal"
                                  }
                                />
                              ) : (
                                <ImagePlus className="h-4 w-4 text-muted-foreground" />
                              )}
                              <input
                                className="sr-only"
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (!file) return;
                                  setProposalImages((current) => ({
                                    ...current,
                                    [proposal.clientKey]: file,
                                  }));
                                  setProposalImagePreviews((current) => ({
                                    ...current,
                                    [proposal.clientKey]:
                                      URL.createObjectURL(file),
                                  }));
                                  if (proposal.caseVariantId)
                                    uploadAttachment.mutate({
                                      id: item.id,
                                      file,
                                      caseVariantId: proposal.caseVariantId,
                                    });
                                }}
                              />
                            </label>
                          </td>
                          <td className="p-2 text-muted-foreground">
                            Supplier proposal
                          </td>
                          <td className="p-2">
                            <Input
                              placeholder="Notes"
                              value={proposal.notes}
                              onChange={(event) =>
                                updateProposal(index, {
                                  notes: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="p-2">
                            <Switch
                              checked={proposal.availability === "available"}
                              onCheckedChange={(checked) =>
                                updateProposal(index, {
                                  availability: checked
                                    ? "available"
                                    : "unavailable",
                                })
                              }
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              placeholder="CNY"
                              value={proposal.unitPriceRmb}
                              onChange={(event) =>
                                updateProposal(index, {
                                  unitPriceRmb: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="p-2">
                            <div className="flex items-center">
                              <Input
                                type="number"
                                placeholder="kg"
                                value={proposal.cartonWeightKg}
                                onChange={(event) =>
                                  updateProposal(index, {
                                    cartonWeightKg: event.target.value,
                                  })
                                }
                              />
                              <span className="-ml-7 text-xs text-muted-foreground">
                                kg
                              </span>
                            </div>
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              placeholder="Pieces"
                              value={proposal.piecesPerSellingUnit}
                              onChange={(event) =>
                                updateProposal(index, {
                                  piecesPerSellingUnit: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="p-2">
                            <div className="flex gap-1">
                              <Input
                                placeholder="L"
                                value={proposal.cartonLengthCm}
                                onChange={(event) =>
                                  updateProposal(index, {
                                    cartonLengthCm: event.target.value,
                                  })
                                }
                              />
                              <Input
                                placeholder="W"
                                value={proposal.cartonWidthCm}
                                onChange={(event) =>
                                  updateProposal(index, {
                                    cartonWidthCm: event.target.value,
                                  })
                                }
                              />
                              <Input
                                placeholder="H"
                                value={proposal.cartonHeightCm}
                                onChange={(event) =>
                                  updateProposal(index, {
                                    cartonHeightCm: event.target.value,
                                  })
                                }
                              />
                            </div>
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              placeholder="Pieces"
                              value={proposal.piecesPerCarton}
                              onChange={(event) =>
                                updateProposal(index, {
                                  piecesPerCarton: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              placeholder="MOQ"
                              value={proposal.moq}
                              onChange={(event) =>
                                updateProposal(index, {
                                  moq: event.target.value,
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={11} className="p-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={addProposal}
                          >
                            + Add supplier variant
                          </Button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {false && (
                  <div className="rounded-lg border border-dashed p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">Supplier-added variants</p>
                        <p className="text-sm text-muted-foreground">
                          Optional proposals are visible only to this supplier
                          and require admin approval.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setProposals((current) => [
                            ...current,
                            {
                              clientKey: crypto.randomUUID(),
                              size: "",
                              material: "",
                              colour: "",
                              customLabel: "",
                              availability: "available",
                              unitPriceRmb: "",
                              piecesPerSellingUnit: "1",
                              cartonLengthCm: "",
                              cartonWidthCm: "",
                              cartonHeightCm: "",
                              cartonWeightKg: "",
                              piecesPerCarton: "",
                              moq: "",
                              leadTimeDays: "",
                              notes: "",
                            },
                          ])
                        }
                      >
                        + Add variant
                      </Button>
                    </div>
                    {proposals.map((proposal, index) => (
                      <div
                        key={proposal.clientKey}
                        className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-4"
                      >
                        <Input
                          placeholder="Size"
                          value={proposal.size}
                          onChange={(event) =>
                            setProposals((current) =>
                              current.map((entry, position) =>
                                position === index
                                  ? { ...entry, size: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <Input
                          placeholder="Material"
                          value={proposal.material}
                          onChange={(event) =>
                            setProposals((current) =>
                              current.map((entry, position) =>
                                position === index
                                  ? { ...entry, material: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <Input
                          placeholder="Colour"
                          value={proposal.colour}
                          onChange={(event) =>
                            setProposals((current) =>
                              current.map((entry, position) =>
                                position === index
                                  ? { ...entry, colour: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <Input
                          placeholder="Custom variant name"
                          value={proposal.customLabel}
                          onChange={(event) =>
                            setProposals((current) =>
                              current.map((entry, position) =>
                                position === index
                                  ? {
                                    ...entry,
                                    customLabel: event.target.value,
                                  }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <Input
                          type="number"
                          placeholder="CNY / unit"
                          value={proposal.unitPriceRmb}
                          onChange={(event) =>
                            setProposals((current) =>
                              current.map((entry, position) =>
                                position === index
                                  ? {
                                    ...entry,
                                    unitPriceRmb: event.target.value,
                                  }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Carton weight kg"
                          value={proposal.cartonWeightKg}
                          onChange={(event) =>
                            setProposals((current) =>
                              current.map((entry, position) =>
                                position === index
                                  ? {
                                    ...entry,
                                    cartonWeightKg: event.target.value,
                                  }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Pieces / carton"
                          value={proposal.piecesPerCarton}
                          onChange={(event) =>
                            setProposals((current) =>
                              current.map((entry, position) =>
                                position === index
                                  ? {
                                    ...entry,
                                    piecesPerCarton: event.target.value,
                                  }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() =>
                            setProposals((current) =>
                              current.filter(
                                (_, position) => position !== index,
                              ),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Textarea
                  value={sheetNotes}
                  onChange={(event) => setSheetNotes(event.target.value)}
                  placeholder="Supplier-wide notes"
                />
                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={quoteSheetLocked || !supplierName.trim()}
                    isLoading={command.isPending}
                    onClick={saveSheet}
                  >
                    Save draft
                  </Button>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            onClick={submitSheet}
                            disabled={
                              quoteSheetLocked ||
                              !!submitBlocker ||
                              command.isPending
                            }
                            isLoading={command.isPending}
                          >
                            <Send className="h-4 w-4" />{" "}
                            {activeCorrection
                              ? "Resubmit corrections"
                              : activeSheetId
                                ? "Update supplier sheet"
                                : "Submit supplier sheet"}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {submitBlocker && (
                        <TooltipContent side="top">
                          {submitBlocker}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </fieldset>
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
                  onClick={() => applyBatch()}
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
      {admin &&
        ["draft", "sourcing", "changes_requested", "quoted"].includes(
          item.stage,
        ) && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Items being sourced</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Requested variants and quantities sent to suppliers for quotes.
                  </p>
                </div>
                <Button size="sm" asChild>
                  <Link href={`${basePath}/${item.id}/edit`}>Edit items</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="p-3">Item</th>
                    <th className="p-3">Quote scope</th>
                    <th className="p-3">Quantity</th>
                    <th className="p-3">Market price</th>
                    <th className="p-3">Marketplace link</th>
                    <th className="p-3">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {item.variants
                    .filter(
                      (variant: any) => variant.proposalStatus !== "dismissed",
                    )
                    .map((variant: any) => {
                      const image = variantAttachments.find(
                        (attachment: any) =>
                          attachment.caseVariantId === variant.id &&
                          attachment.mimeType?.startsWith("image/"),
                      );
                      return (
                        <tr key={variant.id} className="align-top">
                          <td className="p-3">
                            <div className="flex min-w-[220px] items-center gap-3">
                              {image ? (
                                <a
                                  href={image.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Open image"
                                >
                                  <img
                                    src={image.url}
                                    alt={label(variant)}
                                    className="h-12 w-12 rounded border object-cover transition-opacity hover:opacity-75"
                                  />
                                </a>
                              ) : (
                                <div className="h-12 w-12 rounded border bg-muted" />
                              )}
                              <div>
                                <p className="font-medium">{label(variant)}</p>
                                {variant.origin === "sourcer" && (
                                  <Badge className="mt-1">Sourcer added</Badge>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge variant={variant.requestQuote !== false ? "info" : "secondary"}>
                              {variant.requestQuote !== false ? "Requested" : "Not requested"}
                            </Badge>
                          </td>
                          <td className="p-3 font-medium">
                            {variant.requestedQuantity.toLocaleString()} units
                          </td>
                          <td className="p-3">
                            {variant.marketPriceMyr != null ? (
                              `RM ${variant.marketPriceMyr.toFixed(2)}`
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="p-3">
                            {variant.productUrl ? (
                              <a
                                className="text-sky-600 hover:underline"
                                href={variant.productUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open link
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="max-w-64 p-3 text-muted-foreground">
                            {variant.remarks || "-"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      {/* {admin && */}
      {/*   ["draft", "sourcing", "changes_requested", "quoted"].includes( */}
      {/*     item.stage, */}
      {/*   ) && ( */}
      {/*     <Card> */}
      {/*       <CardHeader> */}
      {/*         <CardTitle>Variant planning</CardTitle> */}
      {/*         <p className="text-sm text-muted-foreground"> */}
      {/*           Market price is used for admin viability checks. Turn off quote */}
      {/*           scope to keep a variant out of supplier sheets. */}
      {/*         </p> */}
      {/*       </CardHeader> */}
      {/*       <CardContent className="overflow-x-auto"> */}
      {/*         <table className="w-full min-w-[980px] border-collapse text-sm [&_td]:border [&_th]:border"> */}
      {/*           <thead className="text-left text-muted-foreground"> */}
      {/*             <tr> */}
      {/*               <th className="p-2">Variant</th> */}
      {/*               <th className="p-2">Marketplace link</th> */}
      {/*               <th className="p-2">Remarks</th> */}
      {/*               <th className="p-2">Quote?</th> */}
      {/*               <th className="p-2">Quantity</th> */}
      {/*               <th className="p-2">Market RM</th> */}
      {/*             </tr> */}
      {/*           </thead> */}
      {/*           <tbody> */}
      {/*             {item.variants */}
      {/*               .filter( */}
      {/*                 (variant: any) => variant.proposalStatus !== "dismissed", */}
      {/*               ) */}
      {/*               .map((variant: any) => { */}
      {/*                 const image = variantAttachments.find( */}
      {/*                   (attachment: any) => */}
      {/*                     attachment.caseVariantId === variant.id && */}
      {/*                     attachment.mimeType?.startsWith("image/"), */}
      {/*                 ); */}
      {/*                 const structureLocked = item.quotes.some((quote: any) => */}
      {/*                   ["submitted", "changes_requested"].includes( */}
      {/*                     quote.status, */}
      {/*                   ), */}
      {/*                 ); */}
      {/*                 return ( */}
      {/*                   <tr */}
      {/*                     key={variant.id} */}
      {/*                     className={`border-b align-top ${variant.requestQuote !== false ? "" : "bg-muted/30 text-muted-foreground"}`} */}
      {/*                   > */}
      {/*                     <td className="min-w-44 p-2"> */}
      {/*                       <p className="font-medium"> */}
      {/*                         {variant.customLabel || label(variant)} */}
      {/*                       </p> */}
      {/*                       {variant.origin === "sourcer" && ( */}
      {/*                         <Badge className="mt-1">Sourcer added</Badge> */}
      {/*                       )} */}
      {/*                       <label className="mt-2 flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed bg-background hover:bg-muted"> */}
      {/*                         {image ? ( */}
      {/*                           <img */}
      {/*                             src={image.url} */}
      {/*                             alt={label(variant)} */}
      {/*                             className="h-full w-full object-cover" */}
      {/*                           /> */}
      {/*                         ) : ( */}
      {/*                           <ImagePlus className="h-5 w-5 text-muted-foreground" /> */}
      {/*                         )} */}
      {/*                         <input */}
      {/*                           className="sr-only" */}
      {/*                           type="file" */}
      {/*                           accept="image/jpeg,image/png,image/webp,image/gif" */}
      {/*                           onChange={(event) => { */}
      {/*                             const file = event.target.files?.[0]; */}
      {/*                             if (file) */}
      {/*                               uploadAttachment.mutate({ */}
      {/*                                 id: item.id, */}
      {/*                                 file, */}
      {/*                                 caseVariantId: variant.id, */}
      {/*                               }); */}
      {/*                           }} */}
      {/*                         /> */}
      {/*                       </label> */}
      {/*                       {image && ( */}
      {/*                         <Button */}
      {/*                           className="mt-1" */}
      {/*                           type="button" */}
      {/*                           size="icon" */}
      {/*                           variant="ghost" */}
      {/*                           onClick={() => */}
      {/*                             deleteAttachment.mutate({ */}
      {/*                               id: item.id, */}
      {/*                               attachmentId: image.id, */}
      {/*                             }) */}
      {/*                           } */}
      {/*                         > */}
      {/*                           <Trash2 className="h-3 w-3" /> */}
      {/*                         </Button> */}
      {/*                       )} */}
      {/*                     </td> */}
      {/*                     <td className="p-2"> */}
      {/*                       {variant.productUrl ? ( */}
      {/*                         <a */}
      {/*                           className="text-sky-600 underline" */}
      {/*                           href={variant.productUrl} */}
      {/*                           target="_blank" */}
      {/*                           rel="noreferrer" */}
      {/*                         > */}
      {/*                           Open link */}
      {/*                         </a> */}
      {/*                       ) : ( */}
      {/*                         <span className="text-muted-foreground">-</span> */}
      {/*                       )} */}
      {/*                     </td> */}
      {/*                     <td className="max-w-40 p-2 text-xs text-muted-foreground"> */}
      {/*                       {variant.remarks || "-"} */}
      {/*                     </td> */}
      {/*                     <td className="p-2"> */}
      {/*                       <Switch */}
      {/*                         disabled={structureLocked} */}
      {/*                         checked={variant.requestQuote !== false} */}
      {/*                         onCheckedChange={(requestQuote) => */}
      {/*                           updateCaseVariant(variant, { requestQuote }) */}
      {/*                         } */}
      {/*                       /> */}
      {/*                     </td> */}
      {/*                     <td className="p-2"> */}
      {/*                       <Input */}
      {/*                         className="w-24" */}
      {/*                         type="number" */}
      {/*                         min="1" */}
      {/*                         defaultValue={variant.requestedQuantity || ""} */}
      {/*                         onBlur={(event) => */}
      {/*                           updateCaseVariant(variant, { */}
      {/*                             requestedQuantity: */}
      {/*                               Number(event.target.value) || 1, */}
      {/*                           }) */}
      {/*                         } */}
      {/*                       /> */}
      {/*                     </td> */}
      {/*                     <td className="p-2"> */}
      {/*                       <Input */}
      {/*                         className="w-28" */}
      {/*                         type="number" */}
      {/*                         min="0" */}
      {/*                         step="0.01" */}
      {/*                         defaultValue={variant.marketPriceMyr ?? ""} */}
      {/*                         onBlur={(event) => { */}
      {/*                           const marketPriceMyr = event.target.value */}
      {/*                             ? Number(event.target.value) */}
      {/*                             : undefined; */}
      {/*                           updateMarketBenchmark(variant.id, { */}
      {/*                             marketPriceMyr, */}
      {/*                             marketPack: 1, */}
      {/*                           }); */}
      {/*                           updateCaseVariant(variant, { */}
      {/*                             marketPriceMyr: marketPriceMyr ?? null, */}
      {/*                             marketPack: 1, */}
      {/*                           }); */}
      {/*                         }} */}
      {/*                       /> */}
      {/*                     </td> */}
      {/*                     <td className="p-2"> */}
      {/*                       <Input */}
      {/*                         className="min-w-44" */}
      {/*                         type="url" */}
      {/*                         placeholder="Optional URL" */}
      {/*                         defaultValue={variant.productUrl || ""} */}
      {/*                         onBlur={(event) => */}
      {/*                           updateCaseVariant(variant, { */}
      {/*                             productUrl: event.target.value || null, */}
      {/*                           }) */}
      {/*                         } */}
      {/*                       /> */}
      {/*                     </td> */}
      {/*                     <td className="p-2"> */}
      {/*                       <Textarea */}
      {/*                         className="min-w-48" */}
      {/*                         rows={2} */}
      {/*                         placeholder="Optional remarks" */}
      {/*                         defaultValue={variant.remarks || ""} */}
      {/*                         onBlur={(event) => */}
      {/*                           updateCaseVariant(variant, { */}
      {/*                             remarks: event.target.value || null, */}
      {/*                           }) */}
      {/*                         } */}
      {/*                       /> */}
      {/*                     </td> */}
      {/*                   </tr> */}
      {/*                 ); */}
      {/*               })} */}
      {/*           </tbody> */}
      {/*         </table> */}
      {/*       </CardContent> */}
      {/*     </Card> */}
      {/*   )} */}
      {admin && !decisionsLocked && (
        <Card id="variant-offers" className="scroll-mt-4">
          <CardHeader>
            <div className="flex w-full flex-wrap items-end justify-between gap-3">
              <div>
                <CardTitle>Supplier offer comparison</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Compare supplier offers under each requested variant, then
                  select the offer to order.
                </p>
              </div>
              <div className="ml-auto flex items-end gap-2">
                <label className="grid gap-1 text-sm font-medium">
                  Bulk order qty
                  <Input
                    className="w-32"
                    type="number"
                    min="1"
                    value={bulkOrderQuantity}
                    disabled={decisionsLocked}
                    onChange={(event) =>
                      setBulkOrderQuantity(event.target.value)
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    decisionsLocked ||
                    !Number.isInteger(Number(bulkOrderQuantity)) ||
                    Number(bulkOrderQuantity) < 1
                  }
                  onClick={() => {
                    setOrderQuantities(
                      Object.fromEntries(
                        item.variants
                          .filter(
                            (variant: any) => variant.requestQuote !== false,
                          )
                          .map((variant: any) => [
                            variant.id,
                            bulkOrderQuantity,
                          ]),
                      ),
                    );
                  }}
                >
                  Apply to all
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[1200px] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="w-[260px] p-3">Variant / supplier</th>
                  <th className="p-3">Quote</th>
                  <th className="p-3">Landed cost</th>
                  <th className="p-3">Market / margin</th>
                  <th className="p-3">MOQ / lead time</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              {item.variants.map((variant: any) => {
                const variantOffers = submittedLines.filter(
                  (line: any) =>
                    line.caseVariantId === variant.id &&
                    line.availability === "available",
                );
                const market = {
                  marketPriceMyr: variant.marketPriceMyr ?? undefined,
                  marketPack: variant.marketPack ?? 1,
                };
                const image = variantAttachments.find(
                  (attachment: any) =>
                    attachment.caseVariantId === variant.id &&
                    attachment.mimeType?.startsWith("image/"),
                );
                const selectedOffer = variantOffers.find(
                  (offer: any) => selected[variant.id] === offer.id,
                );
                const orderQuantity = Number(orderQuantities[variant.id]);
                const belowMoq =
                  !!selectedOffer?.moq &&
                  Number.isFinite(orderQuantity) &&
                  orderQuantity < selectedOffer.moq;
                return (
                  <tbody key={variant.id} className="border-b-8 border-white">
                    <tr className="border-t border-slate-200 bg-white">
                      <td className="p-3" colSpan={7}>
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            {selected[variant.id] && (
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                                <Check className="h-3.5 w-3.5" />
                              </span>
                            )}
                            {!selected[variant.id] && skipped[variant.id] && (
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-500 text-white">
                                <CircleAlert className="h-3.5 w-3.5" />
                              </span>
                            )}
                            {image && (
                              <img
                                className="h-10 w-10 rounded border object-cover"
                                src={image.url}
                                alt={label(variant)}
                              />
                            )}
                            <div>
                              <p className="font-semibold">{label(variant)}</p>
                              <p className="text-xs text-muted-foreground">
                                Requested {variant.requestedQuantity} · Market
                                RM {variant.marketPriceMyr ?? "-"} ·{" "}
                                {selected[variant.id]
                                  ? "Offer selected"
                                  : skipped[variant.id]
                                    ? `Skipped: ${skipped[variant.id]}`
                                    : "Needs decision"}
                              </p>
                            </div>
                          </div>
                          <div className="w-44">
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              Order qty
                              <Input
                                className={
                                  belowMoq
                                    ? "border-destructive focus-visible:ring-destructive"
                                    : ""
                                }
                                type="number"
                                min="1"
                                disabled={decisionsLocked}
                                value={
                                  orderQuantities[variant.id] ??
                                  variant.requestedQuantity
                                }
                                onChange={(event) =>
                                  setOrderQuantities((current) => ({
                                    ...current,
                                    [variant.id]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            {belowMoq && (
                              <p className="mt-1 text-xs text-destructive">
                                MOQ is {selectedOffer.moq}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                    {variant.requestQuote === false ? (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={7}>
                          Quote not requested for this variant.
                        </td>
                      </tr>
                    ) : variantOffers.length ? (
                      variantOffers.map((offer: any) => {
                        const evaluation = variantViability(
                          offer,
                          costConfig,
                          market,
                        );
                        const result = evaluation.result;
                        const failureReason =
                          result?.marketPerPiece != null &&
                            result.minViablePrice != null
                            ? result.marketPerPiece < result.landed
                              ? `Landed cost RM ${result.landed.toFixed(2)} is higher than the market price RM ${result.marketPerPiece.toFixed(2)}.`
                              : `Market price RM ${result.marketPerPiece.toFixed(2)} is below the minimum viable price RM ${result.minViablePrice.toFixed(2)}.`
                            : null;
                        const correctionPending =
                          offer.quote.status === "changes_requested";
                        const offerRejected = offer.reviewStatus === "rejected";
                        const chosen = selected[variant.id] === offer.id;
                        const statusBadge = (
                          <Badge
                            className={
                              correctionPending
                                ? "bg-sky-100 text-sky-800"
                                : offerRejected
                                  ? "bg-red-100 text-red-800"
                                  : statusStyle[evaluation.status]
                            }
                          >
                            {correctionPending
                              ? "info requested"
                              : offerRejected
                                ? "rejected"
                                : evaluation.status.replaceAll("_", " ")}
                          </Badge>
                        );
                        return (
                          <tr
                            key={offer.id}
                            className={
                              chosen
                                ? "border-y border-sky-200 bg-sky-50/60"
                                : "bg-slate-50/70"
                            }
                          >
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  checked={chosen}
                                  disabled={
                                    decisionsLocked ||
                                    (evaluation.status !== "pass" &&
                                      evaluation.status !==
                                        "market_unchecked") ||
                                    correctionPending ||
                                    offerRejected
                                  }
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      const quantity = Number(
                                        orderQuantities[variant.id],
                                      );
                                      if (
                                        Number.isInteger(quantity) &&
                                        quantity > 0
                                      ) {
                                        setSelected((current) => ({
                                          ...current,
                                          [variant.id]: offer.id,
                                        }));
                                        setSkipped((current) => {
                                          const next = { ...current };
                                          delete next[variant.id];
                                          return next;
                                        });
                                        command.mutate({
                                          id: item.id,
                                          action: "save_variant_selection",
                                          version: item.version,
                                          selection: {
                                            caseVariantId: variant.id,
                                            quoteLineId: offer.id,
                                            status: "selected",
                                            orderQuantity: quantity,
                                            ...market,
                                          },
                                        });
                                        return;
                                      }
                                      setSelectionDialog({
                                        offer,
                                        variant,
                                        market,
                                      });
                                      setSelectionQuantity(
                                        orderQuantities[variant.id] ||
                                          variant.requestedQuantity.toString(),
                                      );
                                      return;
                                    }
                                    setSelected((current) => {
                                      const next = { ...current };
                                      delete next[variant.id];
                                      return next;
                                    });
                                    command.mutate({
                                      id: item.id,
                                      action: "clear_variant_selection",
                                      version: item.version,
                                      caseVariantId: variant.id,
                                    });
                                  }}
                                  aria-label={`Select offer from ${offer.quote.supplierName}`}
                                />
                                <span className="font-medium">
                                  {offer.quote.supplierName}
                                </span>
                              </div>
                            </td>
                            <td className="p-3">
                              CNY {offer.unitPriceRmb ?? "-"} / unit
                              <span className="block text-xs text-muted-foreground">
                                {offer.piecesPerSellingUnit ?? "-"} pcs / unit
                              </span>
                            </td>
                            <td className="p-3">
                              {result ? `RM ${result.landed.toFixed(2)}` : "-"}
                              {result && (
                                <span className="block text-xs text-muted-foreground">
                                  Product{" "}
                                  {result.productCostPerPiece.toFixed(2)}
                                  {" · "}Freight{" "}
                                  {result.freightPerPiece.toFixed(2)}
                                </span>
                              )}
                            </td>
                            <td className="p-3">
                              {result?.marketPerPiece
                                ? `RM ${result.marketPerPiece.toFixed(2)} · ${result.marginPercent?.toFixed(1)}%`
                                : "Market unchecked"}
                            </td>
                            <td className="p-3">
                              MOQ {offer.moq || "-"}
                              <span className="block text-xs text-muted-foreground">
                                {offer.leadTimeDays ||
                                  offer.quote.leadTimeDays ||
                                  "-"}{" "}
                                days
                              </span>
                            </td>
                            <td className="p-3">
                              {evaluation.status === "fail" &&
                                !offerRejected ? (
                                <TooltipProvider delayDuration={0}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex">
                                        {statusBadge}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      className="max-w-xs"
                                    >
                                      {result?.flags.length
                                        ? result.flags.join(", ")
                                        : failureReason ||
                                        "This offer does not meet the viability requirements."}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                statusBadge
                              )}
                              {result?.flags.length ? (
                                <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                                  <CircleAlert className="h-3 w-3" />
                                  {result.flags.join(", ")}
                                </p>
                              ) : null}
                            </td>
                            <td className="p-3">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={decisionsLocked}
                                    aria-label={`More actions for ${offer.quote.supplierName}`}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                    More
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={
                                      correctionPending || offerRejected
                                    }
                                    onClick={() => {
                                      setChangeDialog({
                                        offer,
                                        variantId: variant.id,
                                      });
                                      setChangeReason("");
                                    }}
                                  >
                                    Request changes
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={offerRejected}
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => {
                                      setSelected((current) => {
                                        if (current[variant.id] !== offer.id)
                                          return current;
                                        const next = { ...current };
                                        delete next[variant.id];
                                        return next;
                                      });
                                      command.mutate({
                                        id: item.id,
                                        action: "reject_variant_offer",
                                        version: item.version,
                                        quoteLineId: offer.id,
                                      });
                                    }}
                                  >
                                    Reject offer
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSkipDialogVariantId(variant.id);
                                      setSkipReason(skipped[variant.id] || "");
                                    }}
                                  >
                                    Skip this variant
                                  </DropdownMenuItem>
                                 </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={7}>
                          No submitted supplier offer covers this variant yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </CardContent>
        </Card>
      )}
      {admin && decisionsLocked && submittedLines.length > 0 && (
        <Card id="historical-variant-offers">
          <details>
            <summary className="cursor-pointer list-none px-6 py-5 font-semibold">
              Historical offer comparison
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                Read-only record of supplier offers and selections
              </span>
            </summary>
            <CardContent className="overflow-x-auto border-t p-0">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="p-3">Variant / supplier</th>
                    <th className="p-3">Quote</th>
                    <th className="p-3">Landed cost</th>
                    <th className="p-3">Market / margin</th>
                    <th className="p-3">MOQ / lead time</th>
                    <th className="p-3">Decision</th>
                  </tr>
                </thead>
                {item.variants.map((variant: any) => {
                  const variantOffers = submittedLines.filter(
                    (line: any) => line.caseVariantId === variant.id,
                  );
                  const image = variantAttachments.find(
                    (attachment: any) =>
                      attachment.caseVariantId === variant.id &&
                      attachment.mimeType?.startsWith("image/"),
                  );
                  return (
                    <tbody key={variant.id} className="border-b-8 border-white">
                      <tr className="bg-muted/20">
                        <td className="p-3" colSpan={6}>
                          <div className="flex items-center gap-3">
                            {image && <img className="h-9 w-9 rounded border object-cover" src={image.url} alt={label(variant)} />}
                            <div><p className="font-semibold">{label(variant)}</p><p className="text-xs text-muted-foreground">Requested {variant.requestedQuantity} · {selected[variant.id] ? "Offer selected" : skipped[variant.id] ? `Skipped: ${skipped[variant.id]}` : "No decision recorded"}</p></div>
                          </div>
                        </td>
                      </tr>
                      {variantOffers.map((offer: any) => {
                        const result = variantViability(offer, costConfig, {
                          marketPriceMyr: variant.marketPriceMyr ?? undefined,
                          marketPack: variant.marketPack ?? 1,
                        }).result;
                        const chosen = selected[variant.id] === offer.id;
                        return <tr key={offer.id} className={chosen ? "bg-sky-50/60" : ""}>
                          <td className="p-3 font-medium">{offer.quote.supplierName}</td>
                          <td className="p-3">CNY {offer.unitPriceRmb ?? "-"} / unit<span className="block text-xs text-muted-foreground">{offer.piecesPerSellingUnit ?? "-"} pcs / unit</span></td>
                          <td className="p-3">{result ? `RM ${result.landed.toFixed(2)}` : "-"}</td>
                          <td className="p-3">{result?.marketPerPiece ? `RM ${result.marketPerPiece.toFixed(2)} · ${result.marginPercent?.toFixed(1)}%` : "Market unchecked"}</td>
                          <td className="p-3">MOQ {offer.moq || "-"}<span className="block text-xs text-muted-foreground">{offer.leadTimeDays || offer.quote.leadTimeDays || "-"} days</span></td>
                          <td className="p-3">{chosen ? <Badge className="bg-emerald-100 text-emerald-800">Selected</Badge> : offer.reviewStatus === "rejected" ? <Badge variant="destructive">Rejected</Badge> : <span className="text-muted-foreground">Not selected</span>}</td>
                        </tr>;
                      })}
                    </tbody>
                  );
                })}
              </table>
            </CardContent>
          </details>
        </Card>
      )}
      {admin && (
        <Dialog
          open={!!skipDialogVariantId}
          onOpenChange={(open) => !open && setSkipDialogVariantId(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Skip this variant</DialogTitle>
            </DialogHeader>
            <Textarea
              autoFocus
              value={skipReason}
              onChange={(event) => setSkipReason(event.target.value)}
              placeholder="Why is this variant not being ordered?"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSkipDialogVariantId(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!skipReason.trim()}
                onClick={() => {
                  if (!skipDialogVariantId) return;
                  setSkipped((current) => ({
                    ...current,
                    [skipDialogVariantId]: skipReason.trim(),
                  }));
                  setSelected((current) => {
                    const next = { ...current };
                    delete next[skipDialogVariantId];
                    return next;
                  });
                  setSkipDialogVariantId(null);
                }}
              >
                Skip variant
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {admin && (
        <Dialog
          open={!!changeDialog}
          onOpenChange={(open) => !open && setChangeDialog(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request changes</DialogTitle>
            </DialogHeader>
            <Textarea
              autoFocus
              value={changeReason}
              onChange={(event) => setChangeReason(event.target.value)}
              placeholder="Describe the changes needed from this supplier"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setChangeDialog(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!changeReason.trim()}
                onClick={() => {
                  if (!changeDialog) return;
                  command.mutate({
                    id: item.id,
                    action: "request_variant_quote_changes",
                    version: item.version,
                    quoteId: changeDialog.offer.quote.id,
                    quoteLineId: changeDialog.offer.id,
                    reason: changeReason.trim(),
                  });
                  setChangeDialog(null);
                }}
              >
                Send request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {admin && (
        <Dialog
          open={!!selectionDialog}
          onOpenChange={(open) => !open && setSelectionDialog(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Select supplier offer</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {selectionDialog?.variant && label(selectionDialog.variant)} from{" "}
              {selectionDialog?.offer.quote.supplierName}
            </p>
            <label className="grid gap-2 text-sm font-medium">
              Quantity to order
              <Input
                type="number"
                min="1"
                autoFocus
                value={selectionQuantity}
                onChange={(event) => setSelectionQuantity(event.target.value)}
              />
            </label>
            {selectionDialog?.offer.moq && (
              <p className="text-sm text-muted-foreground">
                This supplier requires a minimum order quantity of{" "}
                {selectionDialog.offer.moq}.
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelectionDialog(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  !Number.isInteger(Number(selectionQuantity)) ||
                  Number(selectionQuantity) < 1 ||
                  (!!selectionDialog?.offer.moq &&
                    Number(selectionQuantity) < selectionDialog.offer.moq)
                }
                onClick={() => {
                  if (!selectionDialog) return;
                  const { offer, variant, market } = selectionDialog;
                  const quantity = Number(selectionQuantity);
                  setOrderQuantities((current) => ({
                    ...current,
                    [variant.id]: selectionQuantity,
                  }));
                  setSelected((current) => ({
                    ...current,
                    [variant.id]: offer.id,
                  }));
                  setSkipped((current) => {
                    const next = { ...current };
                    delete next[variant.id];
                    return next;
                  });
                  command.mutate({
                    id: item.id,
                    action: "save_variant_selection",
                    version: item.version,
                    selection: {
                      caseVariantId: variant.id,
                      quoteLineId: offer.id,
                      status: "selected",
                      orderQuantity: quantity,
                      ...market,
                    },
                  });
                  setSelectionDialog(null);
                }}
              >
                Select offer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {admin && (
        <AlertDialog
          open={confirmDecisionsOpen}
          onOpenChange={setConfirmDecisionsOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Variants still need a decision
              </AlertDialogTitle>
              <AlertDialogDescription>
                {undecidedVariants.length} variant
                {undecidedVariants.length === 1 ? " has" : "s have"} no selected
                supplier offer or skip reason. Continuing will mark them
                skipped.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Review variants</AlertDialogCancel>
              <AlertDialogAction onClick={confirmSelections}>
                Confirm anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {item.orders.length > 0 && (
        <Card id="purchase-orders">
          <CardHeader>
            <CardTitle>Purchase orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.values(
              item.orders.reduce((groups: Record<string, any[]>, order: any) => {
                const supplier = order.purchaseOrder?.supplier;
                const key = supplier?.id || supplier?.name || "unknown";
                (groups[key] ||= []).push(order);
                return groups;
              }, {}),
            ).map((supplierOrders: any) => {
              const supplier = supplierOrders[0]?.purchaseOrder?.supplier;
              const orders = supplierOrders.map((order: any) => order.purchaseOrder).filter(Boolean);
              const items = orders.flatMap((order: any) => order.items || []);
              const units = items.reduce((sum: number, entry: any) => sum + Number(entry.quantity || 0), 0);
              const total = orders.reduce((sum: number, order: any) => sum + Number(order.totalAmount || 0), 0);
              const currency = orders[0]?.currency || "CNY";
              return (
                <div key={supplier?.id || supplier?.name} className="overflow-hidden rounded-md border">
                  <div className="flex flex-wrap items-center gap-3 bg-muted/50 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1"><p className="font-semibold">{supplier?.name || "Unknown supplier"} <span className="ml-2 font-normal text-muted-foreground">{orders.length} PO{orders.length === 1 ? "" : "s"} · {items.length} product{items.length === 1 ? "" : "s"} · {units.toLocaleString()} units</span></p></div>
                    <p className="font-medium">{currency} {total.toLocaleString()}</p>
                  </div>
                  <div className="divide-y">
                    {orders.map((order: any) => (
                      <div key={order.id}>
                        <div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-2 text-xs text-muted-foreground"><span>{order.poNumber}</span><Link className="text-sky-600 hover:underline" href={`${basePath.includes("/admin") ? "/admin/purchase-orders" : "/sourcing/purchase-orders"}/${order.id}`}>View purchase order</Link></div>
                        {(order.items || []).map((entry: any, index: number) => {
                          const image = variantAttachments.find((attachment: any) => attachment.caseVariantId === entry.sourcingCaseVariantId && attachment.mimeType?.startsWith("image/"));
                          return <div key={entry.id} className="grid grid-cols-[minmax(220px,1fr)_90px_100px_120px] gap-3 px-4 py-3 text-sm">
                            <div className="flex min-w-0 gap-3">{image ? <img src={image.url} alt={entry.productName} className="h-12 w-12 shrink-0 rounded border object-cover" /> : <div className="h-12 w-12 shrink-0 rounded border bg-muted" />}<div className="min-w-0"><p className="line-clamp-2 font-medium">{entry.productName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.sku || "No SKU"} · {currency} {Number(entry.unitCost || 0).toLocaleString()} each</p></div></div>
                            <span className="pt-1">x{Number(entry.quantity || 0).toLocaleString()}</span>
                            {index === 0 ? <Badge variant="secondary" className="h-fit w-fit capitalize">{order.status}</Badge> : <span />}
                            {index === 0 ? <span className="pt-1 font-medium">{currency} {Number(order.totalAmount || 0).toLocaleString()}</span> : <span />}
                          </div>;
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
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
      {admin && item.stage === "quoted" && (
        <div className="sticky bottom-0 z-40 mb-4 rounded-lg border bg-background/95 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm text-muted-foreground">
                  {selectedOfferLines.length} item
                  {selectedOfferLines.length === 1 ? "" : "s"} selected
                </span>
                <span className="text-sm text-muted-foreground">Order value</span>
                <span className="text-lg font-bold text-orange-600">
                  CNY{" "}
                  {selectedOfferLines
                    .reduce(
                      (sum: number, line: any) =>
                        sum +
                        Number(
                          orderQuantities[line.caseVariantId] ||
                            line.requestedQuantity,
                        ) *
                          (line.unitPriceRmb || 0),
                      0,
                    )
                    .toLocaleString()}
                </span>
              </div>
              <Button
                className="bg-orange-500 font-semibold text-white hover:bg-orange-600"
                disabled={!selectedOfferLines.length}
                isLoading={command.isPending}
                onClick={() =>
                  undecidedVariants.length
                    ? setConfirmDecisionsOpen(true)
                    : confirmSelections()
                }
              >
                <Check className="h-4 w-4" /> Checkout ({selectedOfferLines.length})
              </Button>
            </div>
        </div>
      )}
    </main>
  );
}
