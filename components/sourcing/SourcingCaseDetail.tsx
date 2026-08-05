"use client";
/* eslint-disable @next/next/no-img-element -- authenticated attachment URLs require the browser session cookie. */

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Check, FileText, ImageIcon, Plus, Send, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  useCreateSourcingComment,
  useDeleteSourcingAttachment,
  useSourcingAttachments,
  useSourcingCase,
  useSourcingCommand,
  useSourcingMembers,
  useSourcingSuppliers,
  useSourcingWorkspaces,
  useUpdateSourcingRequest,
  useUploadSourcingAttachment,
} from "@/hooks/queries";
import { useShipPurchaseOrder } from "@/hooks/queries/use-purchase-orders";
import { formatMoney } from "@/lib/money";
import {
  getSourcingStageBadgeVariant,
  getSourcingStatusMessage,
  getSourcingTimeline,
  getSourcingTimelineIndex,
  type SourcingViewer,
} from "@/lib/sourcing/presentation";
import {
  sourcingCaseSchema,
  sourcingQuoteSchema,
  type SourcingCaseInput,
  type SourcingQuoteInput,
} from "@/lib/validations/sourcing";
import SourcingPurchaseOrderPanel from "./SourcingPurchaseOrderPanel";
import { SourcingLandedCostCard } from "./SourcingLandedCostCard";
import { SourcingRequestFields } from "./SourcingRequestFields";

const editableStages = ["draft", "sourcing", "changes_requested"];
const label = (value: string) => value.replaceAll("_", " ");
const emptyQuote = {
  supplierName: "",
  piecesPerSellingUnit: 1,
  samplePhotoUrls: [],
  certifications: [],
  priceBreaks: [],
};
const offerKey = (quote: any) => quote.quoteGroupId || quote.id;
function SourcingStageTimeline({
  stage,
  viewer,
  assigneeName,
}: {
  stage: string;
  viewer: SourcingViewer;
  assigneeName?: string | null;
}) {
  const steps = getSourcingTimeline(viewer);
  const currentIndex = getSourcingTimelineIndex(stage, viewer);
  const isTerminal = currentIndex < 0;

  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Sourcing progress">
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-max items-start">
          {steps.map((step, index) => {
            const isComplete = !isTerminal && index < currentIndex;
            const isCurrent = index === currentIndex;
            return (
              <li key={step.id} className="flex items-start">
                <div className="flex w-20 flex-col items-center text-center sm:w-24">
                  <span
                    aria-current={isCurrent ? "step" : undefined}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                      isComplete || isCurrent
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-muted-foreground/30 bg-background text-muted-foreground"
                    }`}
                  >
                    {isComplete ? <Check className="h-4 w-4" /> : index + 1}
                  </span>
                  <span className={`mt-2 text-xs ${isCurrent ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                    {step.label}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <span
                    className={`mt-3 h-px w-8 sm:w-12 ${
                      !isTerminal && index < currentIndex
                        ? "bg-sky-600"
                        : "bg-muted-foreground/25"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {getSourcingStatusMessage(stage, viewer, assigneeName)}
      </p>
    </section>
  );
}

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
  const [dialog, setDialog] = useState<
    "confirm_submit_all" | "confirm_delete" | "decision" | "ship" | null
  >(null);
  const [decisionAction, setDecisionAction] = useState<
    "request_changes" | "reject" | null
  >(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [quoteView, setQuoteView] = useState("compare");
  const [assigneeId, setAssigneeId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [editingRequest, setEditingRequest] = useState(false);
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const draftPhotoInputRef = useRef<HTMLInputElement>(null);
  const { data: item, isLoading, error } = useSourcingCase(caseId);
  const command = useSourcingCommand();
  const shipPurchaseOrder = useShipPurchaseOrder();
  const updateRequest = useUpdateSourcingRequest();
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
  const { data: workspaces = [] } = useSourcingWorkspaces();
  const form = useForm<SourcingQuoteInput>({
    resolver: zodResolver(sourcingQuoteSchema),
    defaultValues: emptyQuote,
  });
  const selectedSupplierId = form.watch("supplierId");
  const requestForm = useForm<SourcingCaseInput>({
    resolver: zodResolver(sourcingCaseSchema),
    defaultValues: { workspaceId: "", title: "", photoUrls: [] },
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
    setAssigneeId(item?.assignedToId || "");
  }, [item?.assignedToId]);
  useEffect(() => {
    if (!item) return;
    requestForm.reset({
      workspaceId: item.workspaceId,
      title: item.title,
      description: item.description,
      photoUrls: [],
      size: item.size,
      material: item.material,
      variant: item.variant,
      specifications: item.specifications,
      referenceUrl: item.referenceUrl,
      notes: item.notes,
      requestedQuantity: item.requestedQuantity,
      targetUnitPriceMyr: item.targetUnitPriceMyr,
      assignedToId: item.assignedToId,
    });
  }, [item, requestForm]);
  useEffect(() => {
    if (item?.stage === "draft" && item.capabilities?.canAssign)
      setEditingRequest(true);
  }, [item?.stage, item?.capabilities?.canAssign]);
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
      return true;
    } catch {
      // The mutation hook already displays the API error as a toast.
      return false;
    }
  };
  const saveQuote = (action: "create_quote" | "save_quote" | "submit_quote") =>
    form.handleSubmit(async (quote) => {
      const saved = await run(action, {
        quote,
        ...(activeQuoteId ? { quoteId: activeQuoteId } : {}),
      });
      if (saved && action === "submit_quote" && !activeQuoteId)
        form.reset(emptyQuote);
    })();
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
  const chooseQuote = (quote: any) => {
    setActiveQuoteId(quote.id);
    setQuoteView("compare");
  };
  const attachments = attachmentData || item.attachments || [];
  const activeQuoteAttachments = activeQuote
    ? attachments.filter(
        (attachment: any) => attachment.quoteId === activeQuote.id,
      )
    : [];
  const caseAttachments = attachments.filter(
    (attachment: any) => !attachment.quoteId,
  );
  const caseImages = caseAttachments.filter((attachment: any) =>
    attachment.mimeType.startsWith("image/"),
  );
  const caseFiles = caseAttachments.filter(
    (attachment: any) => !attachment.mimeType.startsWith("image/"),
  );
  const canEditQuotes =
    item.capabilities.canEditQuote &&
    (editableStages.includes(item.stage) ||
      (item.stage === "quoted" &&
        offers.some((quote: any) => quote.status === "draft")));
  const canEditActiveQuote =
    canEditQuotes && (!activeQuote || activeQuote.status === "draft");
  const isAdminView = basePath.startsWith("/admin");
  const purchaseOrderId = item.orders?.find(
    (order: any) => order.purchaseOrder,
  )?.purchaseOrder?.id;
  const mentionCandidates =
    mentionSearch === null
      ? []
      : members.filter((member: any) =>
          `${member.name || ""} ${member.email || ""}`
            .toLowerCase()
            .includes(mentionSearch.toLowerCase()),
        );

  const updateCommentBody = (value: string, cursor: number) => {
    setCommentBody(value);
    const match = value.slice(0, cursor).match(/(^|\s)@([^\s@]*)$/);
    if (match) {
      setMentionSearch(match[2] ?? "");
      setMentionStart(cursor - (match[2]?.length || 0) - 1);
    } else {
      setMentionSearch(null);
      setMentionStart(null);
    }
  };

  const chooseMention = (member: any) => {
    if (mentionStart === null || mentionSearch === null) return;
    const name = member.name || member.email;
    const end = mentionStart + mentionSearch.length + 1;
    setCommentBody(
      `${commentBody.slice(0, mentionStart)}@${name} ${commentBody.slice(end)}`,
    );
    setMentionedUserIds((ids) =>
      ids.includes(member.id) ? ids : [...ids, member.id],
    );
    setMentionSearch(null);
    setMentionStart(null);
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Link href={basePath} className="text-sm text-sky-600 hover:underline">
        Back to sourcing
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {item.stage === "draft" && item.capabilities.canAssign ? (
            <>
              <p className="text-sm font-medium text-sky-600">
                Sourcing request
              </p>
              <h1 className="mt-1 text-2xl font-bold">
                What do you need us to source?
              </h1>
              <p className="mt-1 text-muted-foreground">
                Start with a name and a photo. Add only the details you know.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold">{item.title}</h1>
            </>
          )}
        </div>
        <Badge
          variant={getSourcingStageBadgeVariant(item.stage)}
          className="capitalize"
        >
          {label(item.stage)}
        </Badge>
      </div>
      {!(item.stage === "draft" && item.capabilities.canAssign) && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Request summary</CardTitle>
              {item.stage === "draft" && item.capabilities.canAssign && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingRequest((open) => !open)}
                >
                  {editingRequest ? "Close editor" : "Edit request"}
                </Button>
              )}
            </div>
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
            {item.capabilities.canAssign &&
              ["draft", "sourcing", "changes_requested", "quoted"].includes(
                item.stage,
              ) && (
                <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
                  <label className="grid min-w-56 flex-1 gap-1 text-sm font-medium">
                    Assign or reassign sourcer
                    <Select value={assigneeId} onValueChange={setAssigneeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a sourcer" />
                      </SelectTrigger>
                      <SelectContent>
                        {members
                          .filter((member: any) => member.role === "sourcer")
                          .map((member: any) => (
                            <SelectItem key={member.id} value={member.id}>
                              {member.name || member.email}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!assigneeId || assigneeId === item.assignedToId}
                    isLoading={command.isPending}
                    onClick={() =>
                      command.mutate({
                        id: item.id,
                        version: item.version,
                        action: "assign",
                        assigneeId,
                      })
                    }
                  >
                    Update assignee
                  </Button>
                </div>
              )}
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
      )}
      {editingRequest &&
        item.stage === "draft" &&
        item.capabilities.canAssign && (
          <form
            className="space-y-5"
            onSubmit={requestForm.handleSubmit(async (values) => {
              const updated: any = await updateRequest.mutateAsync({
                id: item.id,
                version: item.version,
                ...values,
              });
              if (assigneeId && assigneeId !== item.assignedToId)
                await command.mutateAsync({
                  id: item.id,
                  version: updated.version,
                  action: "assign",
                  assigneeId,
                });
            })}
          >
            <SourcingRequestFields
              form={requestForm}
              photos={
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Photos</p>
                      <p className="text-xs text-muted-foreground">
                        A product photo, screenshot, or sample is the fastest
                        way to get an accurate quote.
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {caseImages.length}/5
                    </span>
                  </div>
                  <input
                    ref={draftPhotoInputRef}
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    onChange={async (event) => {
                      const files = Array.from(event.target.files || []).slice(
                        0,
                        Math.max(0, 5 - caseImages.length),
                      );
                      for (const file of files)
                        await uploadAttachment.mutateAsync({
                          id: item.id,
                          file,
                        });
                      event.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => draftPhotoInputRef.current?.click()}
                    className="flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed border-sky-300 bg-sky-50/50 px-4 text-center hover:bg-sky-100/50"
                  >
                    <Upload className="mb-2 h-6 w-6 text-sky-600" />
                    <span className="font-medium text-sky-700">Add photos</span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      JPG, PNG, WEBP, or GIF. Up to 10 MB each.
                    </span>
                  </button>
                  {caseImages.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {caseImages.map((attachment: any) => (
                        <div key={attachment.id} className="relative">
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block overflow-hidden rounded-md border bg-muted/20"
                          >
                            <img
                              src={attachment.url}
                              alt={attachment.fileName}
                              className="h-20 w-20 object-cover"
                            />
                            <span className="block w-20 truncate px-1.5 py-1 text-xs text-muted-foreground">
                              {attachment.fileName}
                            </span>
                          </a>
                          {attachment.canDelete && (
                            <button
                              type="button"
                              className="absolute -right-2 -top-2 rounded-full bg-background p-1 text-destructive shadow"
                              onClick={() =>
                                deleteAttachment.mutate({
                                  id: item.id,
                                  attachmentId: attachment.id,
                                })
                              }
                              aria-label={`Delete ${attachment.fileName}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              }
              workspace={
                <label className="grid gap-1.5 text-sm font-medium">
                  Workspace
                  <Input
                    value={
                      workspaces.find(
                        (workspace: any) => workspace.id === item.workspaceId,
                      )?.name || item.workspaceId
                    }
                    disabled
                  />
                </label>
              }
              assignee={
                <label className="grid gap-1.5 text-sm font-medium">
                  Assign to
                  <Select value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Assign later" />
                    </SelectTrigger>
                    <SelectContent>
                      {members
                        .filter((member: any) => member.role === "sourcer")
                        .map((member: any) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name || member.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </label>
              }
              footer={
                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    isLoading={updateRequest.isPending}
                    onClick={requestForm.handleSubmit((values) =>
                      updateRequest.mutate({
                        id: item.id,
                        version: item.version,
                        ...values,
                      }),
                    )}
                  >
                    Save draft
                  </Button>
                  <Button
                    type="submit"
                    isLoading={updateRequest.isPending || command.isPending}
                  >
                    {assigneeId && assigneeId !== item.assignedToId
                      ? "Save & assign"
                      : "Save request"}
                  </Button>
                </div>
              }
            />
          </form>
        )}
      {item.stage !== "draft" && caseAttachments.length > 0 && (
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
                    rel="noopener noreferrer"
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
              <div className="space-y-2 text-sm">
                {caseFiles.map((attachment: any) => (
                  <a
                    key={attachment.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 hover:text-sky-600"
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FileText className="h-4 w-4" />
                    <span className="truncate">{attachment.fileName}</span>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {item.capabilities.canOrder && item.stage === "approved" && (
        <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">Approved - ready to order</p>
              <p className="text-sm text-muted-foreground">
                Create a purchase order from the approved supplier offer.
              </p>
            </div>
            <Button
              type="button"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              isLoading={command.isPending}
              onClick={() => run("confirm_order")}
            >
              Confirm order
            </Button>
          </CardContent>
        </Card>
      )}
      {item.stage === "ordered" && !isAdminView && (
        <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">Ready to ship</p>
              <p className="text-sm text-muted-foreground">
                Add tracking details and mark this order as shipped.
              </p>
            </div>
            <Button
              type="button"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={!purchaseOrderId}
              onClick={() => {
                setTrackingCarrier("");
                setTrackingNumber("");
                setDialog("ship");
              }}
            >
              Mark as shipped
            </Button>
          </CardContent>
        </Card>
      )}
      <SourcingStageTimeline
        stage={item.stage}
        viewer={isAdminView ? "admin" : "sourcer"}
        assigneeName={item.assignee?.name || item.assignee?.email}
      />
      {item.stage !== "draft" && (
        <Tabs defaultValue="quotes" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2">
            <TabsTrigger value="quotes" className="gap-2 py-2">
              Quotes / offers
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                {offers.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="purchase-orders" className="gap-2 py-2">
              Purchase orders
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                {
                  (item.orders || []).filter(
                    (order: any) => order.purchaseOrder,
                  ).length
                }
              </span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="quotes" className="space-y-6">
            <Tabs
              value={quoteView}
              onValueChange={setQuoteView}
              className="space-y-4"
            >
              {basePath.startsWith("/admin") && (
                <TabsList className="grid h-auto w-full grid-cols-2">
                  <TabsTrigger value="compare">View offers</TabsTrigger>
                  <TabsTrigger value="what-if">What-if calculation</TabsTrigger>
                </TabsList>
              )}
              <TabsContent value="compare" className="space-y-4">
                {offers.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Supplier offer comparison</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                      {offers.map((quote: any) => {
                        const status =
                          item.selectedQuoteId === quote.id
                            ? "approved"
                            : quote.status;
                        return (
                          <div
                            key={offerKey(quote)}
                            role="button"
                            tabIndex={0}
                            onClick={() => chooseQuote(quote)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && chooseQuote(quote)
                            }
                            className={`cursor-pointer rounded-lg border p-4 text-left text-sm ${activeQuoteId === quote.id ? "border-sky-500 ring-1 ring-sky-500" : "hover:bg-muted/50"}`}
                          >
                            <div className="flex justify-between gap-2">
                              <b>{quote.supplierName}</b>
                              <span className="flex items-center gap-2">
                                <Badge
                                  variant={
                                    status === "approved"
                                      ? "success"
                                      : status === "submitted"
                                        ? "info"
                                        : "secondary"
                                  }
                                  className="capitalize"
                                >
                                  {label(status)}
                                </Badge>
                                {quote.status === "draft" &&
                                  item.capabilities.canEditQuote && (
                                    <button
                                      type="button"
                                      className="relative z-10 text-muted-foreground hover:text-destructive"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteTarget({
                                          id: quote.id,
                                          name: quote.supplierName,
                                        });
                                        setDialog("confirm_delete");
                                      }}
                                      aria-label={`Delete ${quote.supplierName} draft`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                              </span>
                            </div>
                            <p className="mt-2">
                              {quote.unitPriceRmb == null
                                ? "No price"
                                : formatMoney(quote.unitPriceRmb, "CNY")}{" "}
                              / unit
                            </p>
                            {typeof quote.landedCostSnapshot?.landed ===
                              "number" && (
                              <p>
                                Landed:{" "}
                                {formatMoney(
                                  quote.landedCostSnapshot.landed,
                                  "MYR",
                                )}{" "}
                                / piece
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
                                <p>
                                  Compliance: {quote.certifications.join(", ")}
                                </p>
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
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                      No quotes or offers yet.
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="what-if" className="space-y-4">
                {offers.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Supplier offer comparison</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                      {offers.map((quote: any) => {
                        const status =
                          item.selectedQuoteId === quote.id
                            ? "approved"
                            : quote.status;
                        return (
                          <div
                            key={offerKey(quote)}
                            role="button"
                            tabIndex={0}
                            onClick={() => setActiveQuoteId(quote.id)}
                            onKeyDown={(event) =>
                              event.key === "Enter" &&
                              setActiveQuoteId(quote.id)
                            }
                            className={`cursor-pointer rounded-lg border p-4 text-left text-sm ${activeQuoteId === quote.id ? "border-sky-500 ring-1 ring-sky-500" : "hover:bg-muted/50"}`}
                          >
                            <div className="flex justify-between gap-2">
                              <b>{quote.supplierName}</b>
                              <Badge
                                variant={
                                  status === "approved"
                                    ? "success"
                                    : status === "submitted"
                                      ? "info"
                                      : "secondary"
                                }
                                className="capitalize"
                              >
                                {label(status)}
                              </Badge>
                            </div>
                            <p className="mt-2">
                              {quote.unitPriceRmb == null
                                ? "No price"
                                : formatMoney(quote.unitPriceRmb, "CNY")}{" "}
                              / unit
                            </p>
                            {typeof quote.landedCostSnapshot?.landed ===
                              "number" && (
                              <p>
                                Landed:{" "}
                                {formatMoney(
                                  quote.landedCostSnapshot.landed,
                                  "MYR",
                                )}{" "}
                                / piece
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
                            <p className="mt-1 text-xs text-muted-foreground">
                              Revision {quote.revision}
                              {item.selectedQuoteId === quote.id
                                ? " | Approved selection"
                                : ""}
                            </p>
                          </div>
                        );
                      })}
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
                {!activeQuote && (
                  <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                      {offers.length > 0
                        ? "Select an offer to model pricing scenarios."
                        : "No quotes or offers yet."}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="compare" className="space-y-4">
                {selectedSubmitted &&
                  item.capabilities.canDecide &&
                  item.stage === "quoted" && (
                    <Card className="border-sky-200 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/20">
                      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div>
                          <p className="font-medium">
                            Review {selectedSubmitted.supplierName}&apos;s offer
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Approve it, send it back for changes, or reject it.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            isLoading={command.isPending}
                            onClick={() =>
                              run("approve", { quoteId: selectedSubmitted.id })
                            }
                          >
                            Approve offer
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={command.isPending}
                            onClick={() => {
                              setDecisionAction("request_changes");
                              setDecisionReason("");
                              setDialog("decision");
                            }}
                          >
                            Request changes
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={command.isPending}
                            onClick={() => {
                              setDecisionAction("reject");
                              setDecisionReason("");
                              setDialog("decision");
                            }}
                          >
                            Reject offer
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                {(activeQuote || canEditActiveQuote) && (
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle>
                          {activeQuote
                            ? `${canEditActiveQuote ? "Edit" : "View"} ${activeQuote.supplierName} offer`
                            : "New supplier offer"}
                        </CardTitle>
                        {canEditQuotes && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setActiveQuoteId(null)}
                          >
                            <Plus className="h-4 w-4" />
                            New offer
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <form
                        className="grid gap-4 sm:grid-cols-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!canEditActiveQuote) return;
                          saveQuote("submit_quote");
                        }}
                      >
                        {!canEditActiveQuote && (
                          <p className="rounded-md border border-blue-200 bg-blue-50/50 p-3 text-sm text-blue-700 sm:col-span-2 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300">
                            This{" "}
                            {item.selectedQuoteId === activeQuote.id
                              ? "approved"
                              : "submitted"}{" "}
                            offer is locked. Create a new offer to submit a
                            revision.
                          </p>
                        )}
                        <fieldset
                          disabled={!canEditActiveQuote}
                          className="contents"
                        >
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
                                else form.setValue("supplierName", "");
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
                                  <SelectItem
                                    key={supplier.id}
                                    value={supplier.id}
                                  >
                                    {supplier.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          {!selectedSupplierId &&
                            field("supplierName", "Supplier name", "text", {
                              required: true,
                            })}
                          {field(
                            "unitPriceRmb",
                            "Supplier CNY cost / selling unit",
                            "number",
                            {
                              required: true,
                              hint: "Price for one bag, pack, carton, or other unit quoted by the supplier.",
                            },
                          )}
                          {field("moq", "MOQ (optional)", "number")}
                          {field(
                            "leadTimeDays",
                            "Lead time in days (optional)",
                            "number",
                          )}
                          <label className="grid gap-1 text-sm font-medium sm:col-span-2">
                            Notes (optional)
                            <Textarea {...form.register("remarks")} />
                          </label>
                          <details className="rounded-lg border p-4 sm:col-span-2">
                            <summary className="cursor-pointer font-medium">
                              Add shipping details (optional)
                            </summary>
                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                              {field(
                                "piecesPerSellingUnit",
                                "Pieces / supplier selling unit",
                                "number",
                                {
                                  hint: "Leave as 1 unless the supplier sells packs or bundles.",
                                },
                              )}
                              {field(
                                "overrideCostMyr",
                                "RM override / selling unit",
                                "number",
                              )}
                              {field(
                                "cartonLengthCm",
                                "Carton length (cm)",
                                "number",
                              )}
                              {field(
                                "cartonWidthCm",
                                "Carton width (cm)",
                                "number",
                              )}
                              {field(
                                "cartonHeightCm",
                                "Carton height (cm)",
                                "number",
                              )}
                              {field(
                                "piecesPerCarton",
                                "Pieces / carton",
                                "number",
                              )}
                              {field(
                                "cartonWeightKg",
                                "Carton weight (kg)",
                                "number",
                              )}
                            </div>
                          </details>
                          {activeQuote && (
                            <div className="space-y-3 rounded-lg border bg-muted/20 p-4 sm:col-span-2">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium">
                                    Quote attachments
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Images, PDFs, and spreadsheets up to 10 MB.
                                  </p>
                                </div>
                                <div>
                                  <input
                                    ref={attachmentInputRef}
                                    className="sr-only"
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/csv,application/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet"
                                    onChange={async (event) => {
                                      const file = event.target.files?.[0];
                                      if (!file) return;
                                      await uploadAttachment.mutateAsync({
                                        id: item.id,
                                        file,
                                        quoteId: activeQuote.id,
                                      });
                                      event.target.value = "";
                                    }}
                                  />
                                  <Button
                                    size="sm"
                                    type="button"
                                    variant="outline"
                                    isLoading={uploadAttachment.isPending}
                                    onClick={() =>
                                      attachmentInputRef.current?.click()
                                    }
                                  >
                                    <Upload className="h-4 w-4" />
                                    Add file
                                  </Button>
                                </div>
                              </div>
                              {activeQuoteAttachments.length ? (
                                <div className="space-y-2">
                                  {activeQuoteAttachments.map(
                                    (attachment: any) => (
                                      <div
                                        key={attachment.id}
                                        className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm"
                                      >
                                        <a
                                          className="flex min-w-0 flex-1 items-center gap-2 hover:text-sky-600"
                                          href={attachment.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          {attachment.mimeType.startsWith(
                                            "image/",
                                          ) ? (
                                            <ImageIcon className="h-4 w-4 shrink-0" />
                                          ) : (
                                            <FileText className="h-4 w-4 shrink-0" />
                                          )}
                                          <span className="truncate">
                                            {attachment.fileName}
                                          </span>
                                        </a>
                                        <span className="hidden text-xs text-muted-foreground sm:inline">
                                          {Math.ceil(
                                            attachment.fileSize / 1024,
                                          )}{" "}
                                          KB
                                        </span>
                                        {attachment.canDelete && (
                                          <Button
                                            size="sm"
                                            type="button"
                                            variant="ghost"
                                            className="text-destructive hover:text-destructive"
                                            isLoading={
                                              deleteAttachment.isPending
                                            }
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
                                    ),
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  No files attached to this quote.
                                </p>
                              )}
                            </div>
                          )}
                        </fieldset>
                        {canEditActiveQuote && (
                          <div className="flex justify-end gap-2 sm:col-span-2">
                            <Button
                              type="button"
                              variant="outline"
                              isLoading={command.isPending}
                              onClick={() =>
                                saveQuote(
                                  activeQuote ? "save_quote" : "create_quote",
                                )
                              }
                            >
                              Save draft
                            </Button>
                            <Button type="submit" isLoading={command.isPending}>
                              Submit offer
                            </Button>
                            {offers.filter((q: any) => q.status === "draft")
                              .length > 1 && (
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
                        )}
                      </form>
                    </CardContent>
                  </Card>
                )}
                {!activeQuote && offers.length > 0 && (
                  <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                      Select an offer to view its details.
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>
          <TabsContent value="purchase-orders">
            <SourcingPurchaseOrderPanel
              orders={item.orders || []}
              basePath={basePath}
            />
          </TabsContent>
        </Tabs>
      )}
      {item.stage !== "draft" && (
        <Card>
          <CardHeader>
            <CardTitle>Comments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Textarea
                value={commentBody}
                onChange={(event) =>
                  updateCommentBody(
                    event.target.value,
                    event.target.selectionStart ?? event.target.value.length,
                  )
                }
                placeholder="Write a comment. Type @ to notify a teammate."
                maxLength={4000}
                className="min-h-20 pr-12"
              />
              {mentionSearch !== null && (
                <div className="absolute bottom-full left-0 z-10 mb-2 w-full max-w-sm overflow-hidden rounded-md border bg-popover shadow-md">
                  {mentionCandidates.length ? (
                    mentionCandidates.map((member: any) => (
                      <button
                        key={member.id}
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseMention(member)}
                      >
                        <span>{member.name || member.email}</span>
                        {member.name && (
                          <span className="text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        )}
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      No matching members
                    </p>
                  )}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Type <b>@</b> to select and notify workspace members.
                </p>
                <Button
                  size="sm"
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
                    setMentionSearch(null);
                    setMentionStart(null);
                  }}
                >
                  <Send className="h-4 w-4" />
                  Send
                </Button>
              </div>
            </div>
            <div className="space-y-2 border-t pt-3">
              {item.comments?.length ? (
                item.comments.map((entry: any) => (
                  <div
                    key={entry.id}
                    className="border-b pb-3 last:border-0 last:pb-0"
                  >
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
                <p className="text-sm text-muted-foreground">
                  No comments yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      <Dialog
        open={dialog === "ship"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark order as shipped</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm font-medium">
              Carrier (optional)
              <Input
                value={trackingCarrier}
                onChange={(event) => setTrackingCarrier(event.target.value)}
                placeholder="e.g. DHL, SF Express"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Tracking number (optional)
              <Input
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="Add it now or update it later"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              disabled={shipPurchaseOrder.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={!purchaseOrderId}
              isLoading={shipPurchaseOrder.isPending}
              onClick={async () => {
                if (!purchaseOrderId) return;
                await shipPurchaseOrder.mutateAsync({
                  id: purchaseOrderId,
                  trackingCarrier: trackingCarrier.trim() || undefined,
                  trackingNumber: trackingNumber.trim() || undefined,
                });
                setDialog(null);
              }}
            >
              Mark as shipped
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === "decision"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionAction === "reject" ? "Reject offer" : "Request changes"}
            </DialogTitle>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            Reason
            <Textarea
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              placeholder={
                decisionAction === "reject"
                  ? "Explain why this offer is not suitable"
                  : "Explain what the sourcer should change"
              }
              autoFocus
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={decisionAction === "reject" ? "destructive" : "default"}
              disabled={!decisionAction || !decisionReason.trim()}
              isLoading={command.isPending}
              onClick={() => {
                if (!decisionAction || !selectedSubmitted) return;
                run(decisionAction, {
                  quoteId: selectedSubmitted.id,
                  reason: decisionReason,
                });
              }}
            >
              {decisionAction === "reject"
                ? "Reject offer"
                : "Send change request"}
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
      <Dialog
        open={dialog === "confirm_delete"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete draft offer</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete the draft offer from
            {deleteTarget ? ` ${deleteTarget.name}` : ""}? This action cannot be
            undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              isLoading={command.isPending}
              onClick={() => {
                if (deleteTarget)
                  run("delete_quote", { quoteId: deleteTarget.id });
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
