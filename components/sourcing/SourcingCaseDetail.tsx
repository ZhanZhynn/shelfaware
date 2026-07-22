"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { CheckCircle, FileText, ImageIcon, MessageSquare, Plus, RefreshCw, Trash2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSourcingComment, useDeleteSourcingAttachment, useLandedCostEstimate, useSourcingAttachments, useSourcingCase, useSourcingCommand, useSourcingMembers, useSourcingSuppliers, useUpdateSourcingNextAction, useUploadSourcingAttachment } from "@/hooks/queries";
import { formatMoney } from "@/lib/money";
import { sourcingQuoteSchema, type SourcingQuoteInput } from "@/lib/validations/sourcing";
import SourcingPurchaseOrderPanel from "./SourcingPurchaseOrderPanel";

const editableStages = ["draft", "sourcing", "changes_requested"];
const label = (value: string) => value.replaceAll("_", " ");
const emptyQuote = { supplierName: "", unitPriceRmb: 0, samplePhotoUrls: [] };
const offerKey = (quote: any) => quote.quoteGroupId || quote.id;

function quoteValues(quote: any): SourcingQuoteInput {
  return {
    supplierId: quote.supplierId || null, supplierName: quote.supplierName,
    unitPriceRmb: quote.unitPriceRmb ?? 0, moq: quote.moq, unitsPerCarton: quote.unitsPerCarton,
    cartonDimensions: quote.cartonDimensions, cartonWeightKg: quote.cartonWeightKg,
    leadTimeDays: quote.leadTimeDays,
    validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString().slice(0, 16) : undefined,
    samplePhotoUrls: Array.isArray(quote.samplePhotoUrls) ? quote.samplePhotoUrls : [], remarks: quote.notes,
  };
}

export default function SourcingCaseDetail({ caseId, basePath = "/sourcing" }: { caseId: string; basePath?: string }) {
  const [mounted, setMounted] = useState(false);
  const [dialog, setDialog] = useState<"assign" | "reason" | null>(null);
  const [reasonAction, setReasonAction] = useState("request_changes");
  const [reason, setReason] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [nextAction, setNextAction] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [slaDueAt, setSlaDueAt] = useState("");
  const [freightMyr, setFreightMyr] = useState("0");
  const [dutyRate, setDutyRate] = useState("0");
  const [taxRate, setTaxRate] = useState("0");
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const { data: item, isLoading, error } = useSourcingCase(caseId);
  const command = useSourcingCommand();
  const comment = useCreateSourcingComment();
  const updateNextAction = useUpdateSourcingNextAction();
  const landedCost = useLandedCostEstimate();
  const { data: attachmentData } = useSourcingAttachments(caseId);
  const uploadAttachment = useUploadSourcingAttachment();
  const deleteAttachment = useDeleteSourcingAttachment();
  const { data: members = [] } = useSourcingMembers(item?.workspaceId || "", !!item?.workspaceId);
  const { data: suppliers = [] } = useSourcingSuppliers(item?.workspaceId || "");
  const form = useForm<SourcingQuoteInput>({ resolver: zodResolver(sourcingQuoteSchema), defaultValues: emptyQuote });
  const activeQuote = item?.quotes?.find((quote: any) => quote.id === activeQuoteId) || null;
  const selectedSubmitted = item?.quotes?.find((quote: any) => quote.id === activeQuoteId && quote.status === "submitted") || null;

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!item) return;
    setNextAction(item.nextAction || "");
    setNextActionAt(item.nextActionAt ? new Date(item.nextActionAt).toISOString().slice(0, 16) : "");
    setSlaDueAt(item.slaDueAt ? new Date(item.slaDueAt).toISOString().slice(0, 16) : "");
  }, [item]);
  useEffect(() => { form.reset(activeQuote ? quoteValues(activeQuote) : emptyQuote); }, [activeQuote, form]);

  if (!mounted || isLoading) return <main className="mx-auto max-w-5xl p-6"><div className="h-64 animate-pulse rounded-xl bg-muted" /></main>;
  if (error || !item) return <main className="p-6 text-destructive">Unable to load this sourcing case.</main>;

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    await command.mutateAsync({ id: item.id, version: item.version, action, ...extra });
    setDialog(null); setReason("");
  };
  const saveQuote = (action: "create_quote" | "save_quote" | "submit_quote") => form.handleSubmit((quote) => run(action, { quote, ...(activeQuoteId ? { quoteId: activeQuoteId } : {}) }))();
  const field = (name: keyof SourcingQuoteInput, title: string, type = "text") => <label className="grid gap-1 text-sm font-medium">{title}<Input type={type} {...form.register(name as any)} /></label>;
  const offers = Object.values((item.quotes || []).reduce((groups: Record<string, any>, quote: any) => {
    const key = offerKey(quote); if (!groups[key] || groups[key].revision < quote.revision) groups[key] = quote; return groups;
  }, {}));
  const chooseQuote = (quote: any) => setActiveQuoteId(quote.id);
  const attachments = attachmentData || item.attachments || [];

  return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <Link href={basePath} className="text-sm text-sky-600 hover:underline">Back to sourcing</Link>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">{item.title}</h1><p className="text-muted-foreground">{item.route === "other" ? "Other supplier route" : "Yiwu route"}</p></div><span className="rounded-full bg-muted px-3 py-1 text-sm capitalize">{label(item.stage)}</span></div>
    <Card><CardHeader><CardTitle>Request summary</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm sm:grid-cols-2"><p><b>Size:</b> {item.size || "Not specified"}</p><p><b>Material:</b> {item.material || "Not specified"}</p><p><b>Variant:</b> {item.variant || "Not specified"}</p><p><b>Requested quantity:</b> {item.requestedQuantity ?? "Not specified"}</p><p><b>Target unit cost:</b> {item.targetUnitPriceMyr == null ? "Not specified" : formatMoney(item.targetUnitPriceMyr, "MYR")}</p><p><b>Assignee:</b> {item.assignee?.name || item.assignee?.email || "Unassigned"}</p><p><b>Reference:</b> {item.referenceUrl ? <a className="text-sky-600 underline" href={item.referenceUrl} target="_blank" rel="noopener noreferrer">Open link</a> : "None"}</p><p className="sm:col-span-2"><b>Specifications:</b> {item.specifications || item.description || "None"}</p><p className="sm:col-span-2"><b>Notes:</b> {item.notes || "None"}</p></CardContent></Card>
    <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Attachments</CardTitle><div><input ref={attachmentInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; await uploadAttachment.mutateAsync({ id: item.id, file }); event.target.value = ""; }} /><Button size="sm" variant="outline" isLoading={uploadAttachment.isPending} onClick={() => attachmentInputRef.current?.click()}><Upload className="h-4 w-4" />Add file</Button></div></div></CardHeader><CardContent className="space-y-2"><p className="text-xs text-muted-foreground">Images, PDFs, and spreadsheet files up to 10 MB.</p>{attachments.length ? attachments.map((attachment: any) => <div key={attachment.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"><a className="flex min-w-0 flex-1 items-center gap-2 hover:text-sky-600" href={attachment.url} target="_blank" rel="noopener noreferrer">{attachment.mimeType.startsWith("image/") ? <ImageIcon className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}<span className="truncate">{attachment.fileName}</span></a><span className="hidden text-xs text-muted-foreground sm:inline">{Math.ceil(attachment.fileSize / 1024)} KB</span>{attachment.canDelete && <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" isLoading={deleteAttachment.isPending} onClick={() => deleteAttachment.mutate({ id: item.id, attachmentId: attachment.id })} aria-label={`Delete ${attachment.fileName}`}><Trash2 className="h-4 w-4" /></Button>}</div>) : <p className="text-sm text-muted-foreground">No attachments yet.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Next action and SLA</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm sm:grid-cols-3"><label className="grid gap-1 font-medium sm:col-span-3">Next action<Input value={nextAction} disabled={!item.capabilities.canUpdateNextAction} maxLength={500} onChange={(event) => setNextAction(event.target.value)} placeholder="Follow up with supplier" /></label><label className="grid gap-1 font-medium">Next action at<Input type="datetime-local" disabled={!item.capabilities.canUpdateNextAction} value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} /></label><label className="grid gap-1 font-medium">SLA due at<Input type="datetime-local" disabled={!item.capabilities.canUpdateNextAction} value={slaDueAt} onChange={(event) => setSlaDueAt(event.target.value)} /></label>{item.capabilities.canUpdateNextAction && <div className="flex items-end"><Button isLoading={updateNextAction.isPending} onClick={() => updateNextAction.mutateAsync({ id: item.id, version: item.version, nextAction, nextActionAt: nextActionAt || null, slaDueAt: slaDueAt || null })}>Save</Button></div>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Workflow</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">{item.capabilities.canAssign && <Button variant="outline" onClick={() => setDialog("assign")}>Assign sourcer</Button>}{item.capabilities.canDecide && item.stage === "quoted" && <><Button disabled={!selectedSubmitted} className="bg-green-600 text-white hover:bg-green-700" onClick={() => selectedSubmitted && run("approve", { quoteId: selectedSubmitted.id })}><CheckCircle className="h-4 w-4" />Approve selected offer</Button><Button disabled={!selectedSubmitted} className="bg-amber-500 text-white hover:bg-amber-600" onClick={() => { setReasonAction("request_changes"); setDialog("reason"); }}><MessageSquare className="h-4 w-4" />Request changes</Button><Button disabled={!selectedSubmitted} variant="destructive" onClick={() => { setReasonAction("reject"); setDialog("reason"); }}><XCircle className="h-4 w-4" />Reject</Button></>}{item.capabilities.canDecide && ["sourcing", "changes_requested"].includes(item.stage) && <Button variant="outline" onClick={() => { setReasonAction("cannot_source"); setDialog("reason"); }}>Cannot source</Button>}{item.capabilities.canOrder && <Button onClick={() => run("confirm_order")}>Create purchase order</Button>}{item.capabilities.canArchive && <Button variant="outline" onClick={() => run("archive")}>Archive</Button>}{item.stage === "archived" && item.capabilities.canAssign && <><Button variant="outline" onClick={() => run("revive")}><RefreshCw className="h-4 w-4" />Revive</Button><Button variant="outline" onClick={() => run("repeat")}>Repeat</Button></>}</CardContent></Card>
    {offers.length > 0 && <Card><CardHeader><CardTitle>Supplier offer comparison</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{offers.map((quote: any) => <button key={offerKey(quote)} type="button" onClick={() => chooseQuote(quote)} className={`rounded-lg border p-4 text-left text-sm ${activeQuoteId === quote.id ? "border-sky-500 ring-1 ring-sky-500" : "hover:bg-muted/50"}`}><div className="flex justify-between gap-2"><b>{quote.supplierName}</b><span className="capitalize text-muted-foreground">{label(quote.status)}</span></div><p className="mt-2">{quote.unitPriceRmb == null ? "No price" : formatMoney(quote.unitPriceRmb, "CNY")} / unit</p><p>MOQ: {quote.moq ?? "-"} | Lead time: {quote.leadTimeDays ?? "-"} days</p><p className="mt-1 text-xs text-muted-foreground">Revision {quote.revision}{item.selectedQuoteId === quote.id ? " | Approved selection" : ""}</p></button>)}</CardContent></Card>}
    {activeQuote?.unitPriceRmb != null && <Card><CardHeader><CardTitle>Landed-cost estimate</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-4"><label className="grid gap-1 text-sm font-medium">Freight (RM)<Input type="number" min="0" value={freightMyr} onChange={(event) => setFreightMyr(event.target.value)} /></label><label className="grid gap-1 text-sm font-medium">Duty %<Input type="number" min="0" max="100" value={dutyRate} onChange={(event) => setDutyRate(event.target.value)} /></label><label className="grid gap-1 text-sm font-medium">Tax %<Input type="number" min="0" max="100" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></label><div className="flex items-end"><Button isLoading={landedCost.isPending} onClick={() => landedCost.mutate({ quantity: item.requestedQuantity || activeQuote.moq || 1, unitPriceCny: activeQuote.unitPriceRmb, fxRate: activeQuote.fxRate || 0.65, freightMyr: Number(freightMyr) || 0, dutyRate: Number(dutyRate) || 0, taxRate: Number(taxRate) || 0 })}>Calculate</Button></div>{landedCost.data && <p className="text-sm sm:col-span-4">Estimated total: <b>{formatMoney(landedCost.data.totalMyr, "MYR")}</b> | Unit landed cost: <b>{formatMoney(landedCost.data.unitLandedMyr, "MYR")}</b> <span className="text-muted-foreground">(estimate only; it does not change the quote or PO)</span></p>}</CardContent></Card>}
    {item.capabilities.canEditQuote && editableStages.includes(item.stage) && <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>{activeQuote ? `Edit ${activeQuote.supplierName} offer` : "New supplier offer"}</CardTitle><Button type="button" variant="outline" onClick={() => setActiveQuoteId(null)}><Plus className="h-4 w-4" />New offer</Button></div></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); saveQuote(activeQuote ? "save_quote" : "create_quote"); }}><label className="grid gap-1 text-sm font-medium">Supplier<Select value={form.watch("supplierId") || "manual"} onValueChange={(value) => { const supplier = suppliers.find((entry: any) => entry.id === value); form.setValue("supplierId", value === "manual" ? null : value); if (supplier) form.setValue("supplierName", supplier.name); }}><SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger><SelectContent><SelectItem value="manual">Manual supplier name</SelectItem>{suppliers.map((supplier: any) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectContent></Select></label>{field("supplierName", "Supplier name")}{field("unitPriceRmb", "RMB unit price", "number")}{field("moq", "MOQ", "number")}{field("unitsPerCarton", "Units/carton", "number")}{field("cartonDimensions", "Carton dimensions")}{field("cartonWeightKg", "Carton weight (kg)", "number")}{field("leadTimeDays", "Lead time (days)", "number")}<label className="grid gap-1 text-sm font-medium">Valid until<Input type="datetime-local" {...form.register("validUntil")} /></label><label className="grid gap-1 text-sm font-medium sm:col-span-2">Sample photo URLs, one per line<Textarea {...form.register("samplePhotoUrls", { setValueAs: (value) => String(value).split("\n").map((url) => url.trim()).filter(Boolean) })} /></label><label className="grid gap-1 text-sm font-medium sm:col-span-2">Remarks<Textarea {...form.register("remarks")} /></label><div className="flex justify-end gap-2 sm:col-span-2"><Button type="submit" variant="outline" isLoading={command.isPending}>{activeQuote ? "Save draft" : "Create offer"}</Button>{activeQuote && <Button type="button" isLoading={command.isPending} onClick={() => saveQuote("submit_quote")}>Submit offer</Button>}</div></form></CardContent></Card>}
    <SourcingPurchaseOrderPanel orders={item.orders || []} basePath={basePath} />
    <Card><CardHeader><CardTitle>Comments</CardTitle></CardHeader><CardContent className="space-y-4"><div className="space-y-3"><Textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add a comment for the sourcing team" maxLength={4000} /><div className="rounded-md border p-3"><p className="mb-2 text-sm font-medium">Notify members (optional)</p><div className="flex flex-wrap gap-x-4 gap-y-2">{members.map((member: any) => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mentionedUserIds.includes(member.id)} onChange={() => setMentionedUserIds((ids) => ids.includes(member.id) ? ids.filter((id) => id !== member.id) : [...ids, member.id])} />{member.name || member.email}</label>)}</div>{members.length === 0 && <p className="text-sm text-muted-foreground">No workspace members available to mention.</p>}</div><div className="flex justify-end"><Button disabled={!commentBody.trim()} isLoading={comment.isPending} onClick={async () => { await comment.mutateAsync({ id: item.id, body: commentBody, mentionedUserIds }); setCommentBody(""); setMentionedUserIds([]); }}>Post comment</Button></div></div><div className="space-y-3">{item.comments?.length ? item.comments.map((entry: any) => <div key={entry.id} className="rounded-md border p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{entry.author?.name || entry.author?.email || "Unknown user"}</span><span className="text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span></div><p className="mt-2 whitespace-pre-wrap text-sm">{entry.body}</p>{Array.isArray(entry.mentionedUserIds) && entry.mentionedUserIds.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Notified: {entry.mentionedUserIds.map((id: string) => { const member = members.find((candidate: any) => candidate.id === id); return member?.name || member?.email || id; }).join(", ")}</p>}</div>) : <p className="text-sm text-muted-foreground">No comments yet.</p>}</div></CardContent></Card>
    <Dialog open={dialog === "assign"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent><DialogHeader><DialogTitle>Assign sourcer</DialogTitle></DialogHeader><Select value={assigneeId} onValueChange={setAssigneeId}><SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger><SelectContent>{members.filter((member: any) => ["admin", "sourcer"].includes(member.role)).map((member: any) => <SelectItem key={member.id} value={member.id}>{member.name || member.email}</SelectItem>)}</SelectContent></Select><DialogFooter><Button disabled={!assigneeId} onClick={() => run("assign", { assigneeId })}>Assign</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={dialog === "reason"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent><DialogHeader><DialogTitle>{label(reasonAction)}</DialogTitle></DialogHeader><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the decision" /><DialogFooter><Button disabled={!reason.trim()} onClick={() => run(reasonAction, { reason, ...(selectedSubmitted ? { quoteId: selectedSubmitted.id } : {}) })}>Confirm</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
