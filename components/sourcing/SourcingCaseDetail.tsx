"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  FileText,
  ImageIcon,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  useCreateSourcingComment,
  useDeleteSourcingAttachment,
  useSourcingAttachments,
  useSourcingCase,
  useSourcingCommand,
  useSourcingMembers,
  useSourcingSuppliers,
  useUploadSourcingAttachment,
} from "@/hooks/queries";
import { formatMoney } from "@/lib/money";
import {
  sourcingQuoteSchema,
  type SourcingQuoteInput,
} from "@/lib/validations/sourcing";
import SourcingPurchaseOrderPanel from "./SourcingPurchaseOrderPanel";
import { SourcingLandedCostCard } from "./SourcingLandedCostCard";

const editableStages = ["draft", "sourcing", "changes_requested"];
const label = (value: string) => value.replaceAll("_", " ");
const emptyQuote = {
  supplierName: "",
  unitPriceRmb: 0,
  piecesPerSellingUnit: 1,
  marketPack: 1,
  samplePhotoUrls: [],
  certifications: [],
  priceBreaks: [],
};
const offerKey = (quote: any) => quote.quoteGroupId || quote.id;

function quoteValues(quote: any): SourcingQuoteInput {
  return {
    supplierId: quote.supplierId || null,
    supplierName: quote.supplierName,
    unitPriceRmb: quote.unitPriceRmb ?? 0,
    piecesPerSellingUnit: quote.piecesPerSellingUnit,
    cartonLengthCm: quote.cartonLengthCm,
    cartonWidthCm: quote.cartonWidthCm,
    cartonHeightCm: quote.cartonHeightCm,
    piecesPerCarton: quote.piecesPerCarton,
    marketPriceMyr: quote.marketPriceMyr,
    marketPack: quote.marketPack,
    overrideCostMyr: quote.overrideCostMyr,
    moq: quote.moq,
    unitsPerCarton: quote.unitsPerCarton,
    cartonDimensions: quote.cartonDimensions,
    cartonWeightKg: quote.cartonWeightKg,
    leadTimeDays: quote.leadTimeDays,
    validUntil: quote.validUntil
      ? new Date(quote.validUntil).toISOString().slice(0, 16)
      : undefined,
    samplePhotoUrls: Array.isArray(quote.samplePhotoUrls)
      ? quote.samplePhotoUrls
      : [],
    remarks: quote.notes,
    paymentTerms: quote.paymentTerms,
    certifications: Array.isArray(quote.certifications)
      ? quote.certifications
      : [],
    complianceNotes: quote.complianceNotes,
    riskLevel: quote.riskLevel,
    recommendation: quote.recommendation,
    priceBreaks: Array.isArray(quote.priceBreaks) ? quote.priceBreaks : [],
  };
}

export default function SourcingCaseDetail({
  caseId,
  basePath = "/sourcing",
}: {
  caseId: string;
  basePath?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [dialog, setDialog] = useState<"confirm_submit" | "confirm_submit_all" | null>(null);
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const { data: item, isLoading, error } = useSourcingCase(caseId);
  const command = useSourcingCommand();
  const comment = useCreateSourcingComment();
  const { data: attachmentData } = useSourcingAttachments(caseId);
  const uploadAttachment = useUploadSourcingAttachment();
  const deleteAttachment = useDeleteSourcingAttachment();
  const { data: members = [] } = useSourcingMembers(
    item?.workspaceId || "",
    !!item?.workspaceId,
  );
  const { data: suppliers = [] } = useSourcingSuppliers(
    item?.workspaceId || "",
  );
  const form = useForm<SourcingQuoteInput>({
    resolver: zodResolver(sourcingQuoteSchema),
    defaultValues: emptyQuote,
  });
  const activeQuote =
    item?.quotes?.find((quote: any) => quote.id === activeQuoteId) || null;
  const selectedSubmitted =
    item?.quotes?.find(
      (quote: any) =>
        quote.id === activeQuoteId && quote.status === "submitted",
    ) || null;

  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    form.reset(activeQuote ? quoteValues(activeQuote) : emptyQuote);
  }, [activeQuote, form]);

  if (!mounted || isLoading)
    return (
      <main className="mx-auto max-w-5xl p-6">
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </main>
    );
  if (error || !item)
    return (
      <main className="p-6 text-destructive">
        Unable to load this sourcing case.
      </main>
    );

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      await command.mutateAsync({
        id: item.id,
        version: item.version,
        action,
        ...extra,
      });
      setDialog(null);
    } catch {
      // The mutation hook already displays the API error as a toast.
    }
  };
  const saveQuote = (action: "create_quote" | "save_quote" | "submit_quote") =>
    form.handleSubmit((quote) =>
      run(action, {
        quote,
        ...(activeQuoteId ? { quoteId: activeQuoteId } : {}),
      }),
    )();
  const field = (
    name: keyof SourcingQuoteInput,
    title: string,
    type = "text",
    options?: { hint?: string; required?: boolean },
  ) => (
    <label className="grid gap-1 text-sm font-medium">
      <span className="flex items-center gap-1">
        {title}
        {options?.required ? " *" : ""}
        {options?.hint && (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                  ?
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="w-64 text-xs">
                {options.hint}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
      <Input
        type={type}
        required={options?.required}
        {...form.register(name as any)}
      />
    </label>
  );
  const offers = Object.values(
    (item.quotes || []).reduce((groups: Record<string, any>, quote: any) => {
      const key = offerKey(quote);
      if (!groups[key] || groups[key].revision < quote.revision)
        groups[key] = quote;
      return groups;
    }, {}),
  );
  const chooseQuote = (quote: any) => setActiveQuoteId(quote.id);
  const attachments = attachmentData || item.attachments || [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Link href={basePath} className="text-sm text-sky-600 hover:underline">
        Back to sourcing
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{item.title}</h1>
          <p className="text-muted-foreground">
            {item.route === "other" ? "Other supplier route" : "Yiwu route"}
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-sm capitalize">
          {label(item.stage)}
        </span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Request summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <b>Size:</b> {item.size || "Not specified"}
          </p>
          <p>
            <b>Material:</b> {item.material || "Not specified"}
          </p>
          <p>
            <b>Variant:</b> {item.variant || "Not specified"}
          </p>
          <p>
            <b>Requested quantity:</b>{" "}
            {item.requestedQuantity ?? "Not specified"}
          </p>
          <p>
            <b>Target unit cost:</b>{" "}
            {item.targetUnitPriceMyr == null
              ? "Not specified"
              : formatMoney(item.targetUnitPriceMyr, "MYR")}
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
                rel="noopener noreferrer"
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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Attachments</CardTitle>
            <div>
              <input
                ref={attachmentInputRef}
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  await uploadAttachment.mutateAsync({ id: item.id, file });
                  event.target.value = "";
                }}
              />
              <Button
                size="sm"
                variant="outline"
                isLoading={uploadAttachment.isPending}
                onClick={() => attachmentInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Add file
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Images, PDFs, and spreadsheet files up to 10 MB.
          </p>
          {attachments.length ? (
            attachments.map((attachment: any) => (
              <div
                key={attachment.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <a
                  className="flex min-w-0 flex-1 items-center gap-2 hover:text-sky-600"
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {attachment.mimeType.startsWith("image/") ? (
                    <ImageIcon className="h-4 w-4 shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{attachment.fileName}</span>
                </a>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {Math.ceil(attachment.fileSize / 1024)} KB
                </span>
                {attachment.canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    isLoading={deleteAttachment.isPending}
                    onClick={() =>
                      deleteAttachment.mutate({
                        id: item.id,
                        attachmentId: attachment.id,
                      })
                    }
                    aria-label={`Delete ${attachment.fileName}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No attachments yet.</p>
          )}
        </CardContent>
      </Card>
      {offers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Supplier offer comparison</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {offers.map((quote: any) => (
              <button
                key={offerKey(quote)}
                type="button"
                onClick={() => chooseQuote(quote)}
                className={`rounded-lg border p-4 text-left text-sm ${activeQuoteId === quote.id ? "border-sky-500 ring-1 ring-sky-500" : "hover:bg-muted/50"}`}
              >
                <div className="flex justify-between gap-2">
                  <b>{quote.supplierName}</b>
                  <span className="capitalize text-muted-foreground">
                    {label(quote.status)}
                  </span>
                </div>
                <p className="mt-2">
                  {quote.unitPriceRmb == null
                    ? "No price"
                    : formatMoney(quote.unitPriceRmb, "CNY")}{" "}
                  / unit
                </p>
                {typeof quote.landedCostSnapshot?.landed === "number" && (
                  <p>
                    Landed:{" "}
                    {formatMoney(quote.landedCostSnapshot.landed, "MYR")} /
                    piece
                  </p>
                )}
                <p>
                  MOQ: {quote.moq ?? "-"} | Lead time:{" "}
                  {quote.leadTimeDays ?? "-"} days
                </p>
                <p>
                  Payment: {quote.paymentTerms || "-"} | Risk:{" "}
                  {quote.riskLevel || "-"}
                </p>
                {Array.isArray(quote.certifications) &&
                  quote.certifications.length > 0 && (
                    <p>Compliance: {quote.certifications.join(", ")}</p>
                  )}
                {Array.isArray(quote.priceBreaks) &&
                  quote.priceBreaks.length > 0 && (
                    <p>
                      Price breaks:{" "}
                      {quote.priceBreaks
                        .map(
                          (breakpoint: any) =>
                            `${breakpoint.minQuantity}+: ${formatMoney(breakpoint.unitPriceRmb, "CNY")}`,
                        )
                        .join(" | ")}
                    </p>
                  )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Revision {quote.revision}
                  {item.selectedQuoteId === quote.id
                    ? " | Approved selection"
                    : ""}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
      {activeQuote &&
        item.capabilities.canAssign &&
        (!item.capabilities.canEditQuote ||
          !editableStages.includes(item.stage)) && (
          <SourcingLandedCostCard
            key={`scenario-${activeQuote.id}`}
            workspaceId={item.workspaceId}
            caseId={item.id}
            quoteId={activeQuote.id}
            quote={activeQuote}
          />
        )}
      {item.capabilities.canEditQuote &&
        editableStages.includes(item.stage) && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  {activeQuote
                    ? `Edit ${activeQuote.supplierName} offer`
                    : "New supplier offer"}
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveQuoteId(null)}
                >
                  <Plus className="h-4 w-4" />
                  New offer
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveQuote(activeQuote ? "save_quote" : "create_quote");
                }}
              >
                <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground sm:col-span-2">
                  Fields marked * are required. A supplier CNY cost or RM
                  override is required before submission. Quote the
                  supplier&apos;s actual selling unit, then state how many
                  customer-facing pieces it contains. Carton details are needed
                  to include freight; competitor pricing is optional and is only
                  used for margin analysis.
                </p>
                <label className="grid gap-1 text-sm font-medium">
                  Supplier
                  <Select
                    value={form.watch("supplierId") || "manual"}
                    onValueChange={(value) => {
                      const supplier = suppliers.find(
                        (entry: any) => entry.id === value,
                      );
                      form.setValue(
                        "supplierId",
                        value === "manual" ? null : value,
                      );
                      if (supplier)
                        form.setValue("supplierName", supplier.name);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">
                        Manual supplier name
                      </SelectItem>
                      {suppliers.map((supplier: any) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                {field("supplierName", "Supplier name", "text", {
                  required: true,
                })}
                {field(
                  "unitPriceRmb",
                  "Supplier CNY cost / selling unit",
                  "number",
                  {
                    hint: "Price for one bag, pack, carton, or other unit quoted by the supplier.",
                  },
                )}
                {field(
                  "piecesPerSellingUnit",
                  "Pieces / supplier selling unit",
                  "number",
                  {
                    required: true,
                    hint: "For a 50-piece bag, enter 50. Use 1 only when the supplier sells one piece.",
                  },
                )}
                {field(
                  "overrideCostMyr",
                  "RM override / selling unit",
                  "number",
                  {
                    hint: "Optional. Use only when an agent has agreed an RM price for the same supplier unit.",
                  },
                )}
                {field("moq", "MOQ", "number")}
                {field("cartonLengthCm", "Carton length (cm)", "number", {
                  hint: "Outer carton measurement. Needed to allocate freight by volume.",
                })}
                {field("cartonWidthCm", "Carton width (cm)", "number", {
                  hint: "Outer carton measurement in centimetres.",
                })}
                {field("cartonHeightCm", "Carton height (cm)", "number", {
                  hint: "Outer carton measurement in centimetres.",
                })}
                {field("piecesPerCarton", "Pieces / carton", "number", {
                  hint: "Count individual customer-facing pieces, not bags or packs.",
                })}
                {field(
                  "marketPriceMyr",
                  "Competitor listing price (RM)",
                  "number",
                  {
                    hint: "Optional. Enter the full Shopee/Lazada listing price.",
                  },
                )}
                {field("marketPack", "Pieces / competitor listing", "number", {
                  hint: "For a 10-piece competitor bundle, enter 10.",
                })}
                {field("cartonWeightKg", "Carton weight (kg)", "number")}
                {field("leadTimeDays", "Lead time (days)", "number")}
                <label className="grid gap-1 text-sm font-medium">
                  Valid until
                  <Input
                    type="datetime-local"
                    {...form.register("validUntil")}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium sm:col-span-2">
                  Sample photo URLs, one per line
                  <Textarea
                    {...form.register("samplePhotoUrls", {
                      setValueAs: (value) =>
                        String(value)
                          .split("\n")
                          .map((url) => url.trim())
                          .filter(Boolean),
                    })}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium sm:col-span-2">
                  Remarks
                  <Textarea {...form.register("remarks")} />
                </label>
                <div className="flex justify-end gap-2 sm:col-span-2">
                  <Button
                    type="submit"
                    variant="outline"
                    isLoading={command.isPending}
                  >
                    {activeQuote ? "Save draft" : "Create offer"}
                  </Button>
                  {activeQuote && (
                    <Button
                      type="button"
                      isLoading={command.isPending}
                      onClick={() => setDialog("confirm_submit")}
                    >
                      Submit offer
                    </Button>
                  )}
                  {offers.filter((q: any) => q.status === "draft").length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      isLoading={command.isPending}
                      onClick={() => setDialog("confirm_submit_all")}
                    >
                      Submit all drafts
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      <SourcingPurchaseOrderPanel
        orders={item.orders || []}
        basePath={basePath}
      />
      <Card>
        <CardHeader>
          <CardTitle>Comments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Textarea
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              placeholder="Add a comment for the sourcing team"
              maxLength={4000}
            />
            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">
                Notify members (optional)
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {members.map((member: any) => (
                  <label
                    key={member.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={mentionedUserIds.includes(member.id)}
                      onChange={() =>
                        setMentionedUserIds((ids) =>
                          ids.includes(member.id)
                            ? ids.filter((id) => id !== member.id)
                            : [...ids, member.id],
                        )
                      }
                    />
                    {member.name || member.email}
                  </label>
                ))}
              </div>
              {members.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No workspace members available to mention.
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <Button
                disabled={!commentBody.trim()}
                isLoading={comment.isPending}
                onClick={async () => {
                  await comment.mutateAsync({
                    id: item.id,
                    body: commentBody,
                    mentionedUserIds,
                  });
                  setCommentBody("");
                  setMentionedUserIds([]);
                }}
              >
                Post comment
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {item.comments?.length ? (
              item.comments.map((entry: any) => (
                <div key={entry.id} className="rounded-md border p-3">
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
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {entry.body}
                  </p>
                  {Array.isArray(entry.mentionedUserIds) &&
                    entry.mentionedUserIds.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Notified:{" "}
                        {entry.mentionedUserIds
                          .map((id: string) => {
                            const member = members.find(
                              (candidate: any) => candidate.id === id,
                            );
                            return member?.name || member?.email || id;
                          })
                          .join(", ")}
                      </p>
                    )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={dialog === "confirm_submit"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit quote</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to submit this quote? Once submitted, the
            quote cannot be changed unless a new quote is submitted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => saveQuote("submit_quote")}>
              Submit quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === "confirm_submit_all"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit all draft quotes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to submit all draft quotes? Once submitted,
            quotes cannot be changed unless new quotes are submitted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              isLoading={command.isPending}
              onClick={() => run("submit_all_drafts")}
            >
              Submit all drafts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
