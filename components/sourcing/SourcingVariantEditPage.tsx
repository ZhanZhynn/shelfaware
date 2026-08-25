"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ImagePlus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSourcingCase, useSourcingCommand, useUpdateSourcingRequest, useUploadSourcingAttachment } from "@/hooks/queries";
import {
  SourcingVariantBuilder,
  type VariantDraft,
} from "./SourcingVariantBuilder";

const key = (variant: { size?: string | null; material?: string | null; colour?: string | null }) =>
  [variant.size || "", variant.material || "", variant.colour || ""].join("|");

export default function SourcingVariantEditPage({ caseId }: { caseId: string }) {
  const router = useRouter();
  const { data: item, isLoading, error } = useSourcingCase(caseId);
  const command = useSourcingCommand();
  const updateRequest = useUpdateSourcingRequest();
  const uploadPhoto = useUploadSourcingAttachment();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<VariantDraft[]>([]);
  const [images, setImages] = useState<Record<string, File | undefined>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [requestedQuantity, setRequestedQuantity] = useState("");
  const [specifications, setSpecifications] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!item?.variants) return;
    setDrafts(
      item.variants
        .filter((variant: any) => variant.origin === "admin")
        .map((variant: any) => ({
          clientKey: variant.id,
          imageKey: variant.id,
          size: variant.size || "",
          material: variant.material || "",
          colour: variant.colour || "",
          requestedQuantity: variant.requestedQuantity,
          marketPriceMyr: variant.marketPriceMyr?.toString() || "",
          requestQuote: variant.requestQuote !== false,
          productUrl: variant.productUrl || "",
          remarks: variant.remarks || "",
        })),
    );
    setTitle(item.title || "");
    setRequestedQuantity(item.requestedQuantity?.toString() || "");
    setSpecifications(item.specifications || "");
  }, [item?.id]);

  // The query can briefly report an error on the client's first render while its
  // browser request starts; keep the SSR and hydration shells identical.
  if (!mounted || isLoading) return <main className="mx-auto max-w-3xl p-6"><div className="h-64 animate-pulse rounded-xl bg-muted" /></main>;
  if (error || !item) return <main className="p-6 text-destructive">Unable to load sourcing request.</main>;
  const editable = ["draft", "sourcing", "changes_requested", "quoted"].includes(item.stage);
  const save = async () => {
    const request: any = await updateRequest.mutateAsync({
      id: item.id,
      version: item.version,
      title,
      requestedQuantity: requestedQuantity ? Number(requestedQuantity) : null,
      specifications: specifications || null,
    });
    let version = request.version;
    for (const photo of photos)
      await uploadPhoto.mutateAsync({ id: item.id, file: photo });
    const existing = new Map<string, any>(
      item.variants
        .filter((variant: any) => variant.origin === "admin")
        .map((variant: any) => [key(variant), variant]),
    );
    const draftKeys = new Set(drafts.map(key));
    for (const variant of existing.values()) {
      if (draftKeys.has(key(variant))) continue;
      const updated: any = await command.mutateAsync({
        id: item.id,
        action: "remove_case_variant",
        version,
        caseVariantId: variant.id,
      });
      version = updated.version;
    }
    for (const draft of drafts) {
      const input = {
        size: draft.size || null,
        material: draft.material || null,
        colour: draft.colour || null,
        requestedQuantity: Number(draft.requestedQuantity) || 1,
        marketPriceMyr: draft.marketPriceMyr ? Number(draft.marketPriceMyr) : null,
        marketPack: 1,
        requestQuote: draft.requestQuote,
        productUrl: draft.productUrl || null,
        remarks: draft.remarks || null,
      };
      const current = existing.get(key(draft));
      const updated: any = await command.mutateAsync(
        current
          ? { id: item.id, action: "update_case_variant", version, variant: { caseVariantId: current.id, ...input } }
          : { id: item.id, action: "add_case_variant", version, newVariant: input },
      );
      version = updated.version;
    }
    router.push(`/admin/sourcing/${item.id}`);
  };
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><Link href={`/admin/sourcing/${item.id}`} className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Back to request</Link><h1 className="mt-1 text-2xl font-bold">Edit variants</h1><p className="mt-1 text-muted-foreground">{item.title}</p></div>
        <Button disabled={!editable || command.isPending || updateRequest.isPending || uploadPhoto.isPending} isLoading={command.isPending || updateRequest.isPending || uploadPhoto.isPending} onClick={() => void save()}><Save className="h-4 w-4" /> Save changes</Button>
      </div>
      {!editable ? <Card><CardContent className="p-6 text-muted-foreground">This request can no longer be changed at this stage.</CardContent></Card> : <>
        <Card><CardHeader><CardTitle>Product details</CardTitle></CardHeader><CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]"><label className="grid gap-1.5 text-sm font-medium">What product do you need? <span className="text-destructive">*</span><Input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="grid gap-1.5 text-sm font-medium">Units per variant<Input type="number" min="1" placeholder="Optional" value={requestedQuantity} onChange={(event) => setRequestedQuantity(event.target.value)} /></label></div>
          <div><div className="mb-2 flex items-center justify-between"><div><p className="text-sm font-medium">Photos</p><p className="text-xs text-muted-foreground">A product photo, screenshot, or sample is the fastest way to get an accurate quote.</p></div><span className="text-xs text-muted-foreground">{(item.attachments || []).filter((attachment: any) => !attachment.caseVariantId && attachment.mimeType?.startsWith("image/")).length + photos.length}/5</span></div><input ref={photoInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => { setPhotos((current) => [...current, ...Array.from(event.target.files || [])].slice(0, 5)); event.target.value = ""; }} /><button type="button" onClick={() => photoInputRef.current?.click()} className="flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed border-sky-300 bg-sky-50/50 px-4 text-center"><ImagePlus className="mb-2 h-6 w-6 text-sky-600" /><span className="font-medium text-sky-700">Add photos</span><span className="mt-1 text-xs text-muted-foreground">JPG, PNG, WEBP, or GIF. Up to 10 MB each.</span></button>{photos.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{photos.map((photo, index) => <div key={`${photo.name}-${photo.lastModified}`} className="flex items-center gap-1 rounded border px-2 py-1 text-sm"><span className="max-w-44 truncate">{photo.name}</span><button type="button" onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))} aria-label={`Remove ${photo.name}`}><Trash2 className="h-3.5 w-3.5 text-destructive" /></button></div>)}</div>}</div>
          <label className="grid gap-1.5 text-sm font-medium">What is important? <span className="font-normal text-muted-foreground">Optional</span><Textarea rows={3} value={specifications} onChange={(event) => setSpecifications(event.target.value)} placeholder="Example: Must be foldable, natural colour, similar to the photo. Need it before Hari Raya." /></label>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Variants to source</CardTitle></CardHeader><CardContent><SourcingVariantBuilder variants={drafts} images={images} initialImageUrls={Object.fromEntries((item.attachments || []).filter((attachment: any) => attachment.caseVariantId && attachment.mimeType?.startsWith("image/")).map((attachment: any) => [attachment.caseVariantId, attachment.url]))} onChange={setDrafts} onImageChange={(clientKey, file) => setImages((current) => ({ ...current, [clientKey]: file }))} /></CardContent></Card>
      </>}
    </main>
  );
}
