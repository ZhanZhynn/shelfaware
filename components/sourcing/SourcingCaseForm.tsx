"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateSourcingCase,
  useCreateSourcingTemplate,
  useSourcingDuplicates,
  useSourcingMembers,
  useSourcingTemplates,
  useSourcingWorkspaces,
  useUploadSourcingAttachment,
} from "@/hooks/queries";
import {
  sourcingCaseSchema,
  type SourcingCaseInput,
} from "@/lib/validations/sourcing";
import {
  SourcingVariantBuilder,
  newVariantDraft,
  type VariantDraft,
} from "./SourcingVariantBuilder";

const MAX_PHOTOS = 5;

export default function SourcingCaseForm({
  basePath = "/sourcing",
}: {
  basePath?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const { data: workspaces = [] } = useSourcingWorkspaces();
  const form = useForm<SourcingCaseInput>({
    resolver: zodResolver(sourcingCaseSchema),
    defaultValues: {
      workspaceId: params.get("workspaceId") || "",
      title: "",
      photoUrls: [],
      variants: [],
    },
  });
  const workspaceId = form.watch("workspaceId");
  const canAssign = !!workspaces.find(
    (workspace: any) => workspace.id === workspaceId,
  )?.canAssign;
  const { data: members = [] } = useSourcingMembers(workspaceId, canAssign);
  const sourcers = members.filter((member: any) => member.role === "sourcer");
  const create = useCreateSourcingCase();
  const uploadPhoto = useUploadSourcingAttachment();
  const createTemplate = useCreateSourcingTemplate();
  const { data: templates = [] } = useSourcingTemplates(workspaceId);
  const [templateName, setTemplateName] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([
    newVariantDraft(),
  ]);
  const [variantImages, setVariantImages] = useState<
    Record<string, File | undefined>
  >({});
  const title = form.watch("title") || "";
  const assignedToId = form.watch("assignedToId");
  const isAdminView = basePath.startsWith("/admin");
  const { data: duplicates = [] } = useSourcingDuplicates(workspaceId, title);

  useEffect(() => {
    if (!workspaceId && workspaces[0]?.id)
      form.setValue("workspaceId", workspaces[0].id);
  }, [form, workspaceId, workspaces]);

  const generatedVariants = variantDrafts.map(
    ({
      clientKey: _clientKey,
      imageKey: _imageKey,
      marketPriceMyr,
      ...variant
    }) => ({
      ...variant,
      marketPriceMyr: marketPriceMyr ? Number(marketPriceMyr) : undefined,
      marketPack: 1,
    }),
  );
  const submit = async (values: SourcingCaseInput, assign: boolean) => {
    const result: any = await create.mutateAsync({
      ...values,
      variants: generatedVariants,
      assignedToId: assign ? values.assignedToId : undefined,
    });
    for (const photo of photos)
      await uploadPhoto.mutateAsync({ id: result.id, file: photo });
    for (const [index, draft] of variantDrafts.entries()) {
      const file = draft.imageKey ? variantImages[draft.imageKey] : undefined;
      const variant = result.variants?.[index];
      if (file && variant)
        await uploadPhoto.mutateAsync({
          id: result.id,
          file,
          caseVariantId: variant.id,
        });
    }
    router.push(`${basePath}/${result.id}`);
  };

  const selectPhotos = (files: FileList | null) => {
    if (!files) return;
    setPhotos((current) =>
      [...current, ...Array.from(files)].slice(0, MAX_PHOTOS),
    );
  };

  const field = (
    name: keyof SourcingCaseInput,
    label: string,
    placeholder?: string,
    type = "text",
  ) => (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <Input
        type={type}
        placeholder={placeholder}
        {...form.register(name as any)}
      />
    </label>
  );
  const isSubmitting = create.isPending || uploadPhoto.isPending;
  const submitForm = (assign: boolean) => {
    if (
      !generatedVariants.length ||
      generatedVariants.some(
        (variant) => !variant.size && !variant.material && !variant.colour,
      )
    ) {
      form.setError("variants", {
        message: "Each variant needs a size, material, or colour.",
      });
      return;
    }
    form.setValue("variants", generatedVariants, { shouldValidate: true });
    void form.handleSubmit((values) => submit(values, assign))();
  };

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div>
        <p className="text-sm font-medium text-sky-600">New request</p>
        <h1 className="mt-1 text-2xl font-bold">Request a product</h1>
        <p className="mt-1 text-muted-foreground">
          Tell the sourcing team what you need. You can add more details later.
        </p>
      </div>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          submitForm(!!form.getValues("assignedToId"));
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Product details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <label className="grid gap-1.5 text-sm font-medium">
                <span>
                  What product do you need?{" "}
                  <span className="text-destructive">*</span>
                </span>
                <Input
                  placeholder="e.g. Linen storage basket"
                  {...form.register("title")}
                  autoFocus
                />
                {form.formState.errors.title && (
                  <span className="text-xs text-destructive">
                    {form.formState.errors.title.message}
                  </span>
                )}
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Units per variant
                <Input
                  type="number"
                  min="1"
                  placeholder="Optional"
                  {...form.register("requestedQuantity")}
                />
              </label>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Photos</p>
                  <p className="text-xs text-muted-foreground">
                    A product photo, screenshot, or sample is the fastest way to
                    get an accurate quote.
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {photos.length}/{MAX_PHOTOS}
                </span>
              </div>
              <input
                ref={photoInputRef}
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={(event) => {
                  selectPhotos(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed border-sky-300 bg-sky-50/50 px-4 text-center transition-colors hover:bg-sky-100/50 dark:border-sky-800 dark:bg-sky-950/20"
              >
                <ImagePlus className="mb-2 h-6 w-6 text-sky-600" />
                <span className="font-medium text-sky-700 dark:text-sky-300">
                  Add photos
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  JPG, PNG, WEBP, or GIF. Up to 10 MB each.
                </span>
              </button>
              {photos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-3">
                  {photos.map((photo, index) => (
                    <div
                      key={`${photo.name}-${photo.lastModified}`}
                      className="group relative h-20 w-20 overflow-hidden rounded-md border bg-background"
                    >
                      {/* Local previews let the requester verify the exact files before case creation. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={URL.createObjectURL(photo)}
                        alt={photo.name}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded bg-background/90 p-1 text-destructive opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-destructive/80"
                        onClick={() =>
                          setPhotos((current) =>
                            current.filter(
                              (_, photoIndex) => photoIndex !== index,
                            ),
                          )
                        }
                        aria-label={`Remove ${photo.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              What is important?{" "}
              <span className="font-normal text-muted-foreground">
                Optional
              </span>
              <Textarea
                rows={3}
                placeholder="Example: Must be foldable, natural colour, similar to the photo. Need it before Hari Raya."
                {...form.register("specifications")}
              />
            </label>
          </CardContent>
        </Card>

        {duplicates.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20">
            <CardContent className="p-4 text-sm">
              <p className="font-medium">Similar requests already exist</p>
              <p className="mt-1 text-muted-foreground">
                Open an existing request or continue creating this one.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {duplicates.map((item: any) => (
                  <Button
                    key={item.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    asChild
                  >
                    <Link href={`${basePath}/${item.id}`}>{item.title}</Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <details open className="group rounded-xl border bg-card">
          <summary className="cursor-pointer list-none px-6 py-5 font-semibold">
            Add more details{" "}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              Optional
            </span>
          </summary>
          <CardContent className="grid gap-4 border-t pt-5 sm:grid-cols-2">
            {/* {workspaces.length > 1 && ( */}
            {/*   <label className="grid gap-1.5 text-sm font-medium"> */}
            {/*     Workspace */}
            {/*     <Select value={workspaceId} onValueChange={(value) => form.setValue("workspaceId", value)}> */}
            {/*       <SelectTrigger><SelectValue placeholder="Select workspace" /></SelectTrigger> */}
            {/*       <SelectContent>{workspaces.map((workspace: any) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent> */}
            {/*     </Select> */}
            {/*   </label> */}
            {/* )} */}
            {/* {field("targetUnitPriceMyr", "Target unit cost (RM)", "Optional", "number")} */}
            <div className="sm:col-span-2">
              <p className="font-medium">
                Variants to source <span className="text-destructive">*</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add each sellable variation, its optional marketplace reference,
                and one primary image.
              </p>
            </div>
            <div className="sm:col-span-2">
              <SourcingVariantBuilder
                variants={variantDrafts}
                images={variantImages}
                onChange={setVariantDrafts}
                onImageChange={(clientKey, file) =>
                  setVariantImages((current) => ({
                    ...current,
                    [clientKey]: file,
                  }))
                }
              />
              {form.formState.errors.variants && (
                <p className="mt-2 text-xs text-destructive">
                  {form.formState.errors.variants.message}
                </p>
              )}
            </div>
            {field(
              "referenceUrl",
              "Product link",
              "Paste a Shopee, Lazada, or website link",
            )}
            {templates.length > 0 && (
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                Start from a saved template
                <Select
                  onValueChange={(id) => {
                    const template: any = templates.find(
                      (entry: any) => entry.id === id,
                    );
                    if (template?.data)
                      Object.entries(template.data).forEach(([key, value]) =>
                        form.setValue(
                          key as keyof SourcingCaseInput,
                          value as never,
                        ),
                      );
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template: any) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            {/* {isAdminView && ( */}
            {/*   <div className="grid gap-2 border-t pt-4 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_auto]"> */}
            {/*     <Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Reusable template name" /> */}
            {/*     <Button type="button" variant="outline" disabled={!workspaceId || !templateName.trim()} isLoading={createTemplate.isPending} onClick={async () => { */}
            {/*       const values = form.getValues(); */}
            {/*       await createTemplate.mutateAsync({ workspaceId, name: templateName, data: { title: values.title, size: values.size, material: values.material, variant: values.variant, specifications: values.specifications, requestedQuantity: values.requestedQuantity, targetUnitPriceMyr: values.targetUnitPriceMyr } }); */}
            {/*       setTemplateName(""); */}
            {/*     }}>Save as reusable template</Button> */}
            {/*   </div> */}
            {/* )} */}
          </CardContent>
        </details>

        <Card>
          <CardHeader>
            <CardTitle>Choose a sourcer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {canAssign ? (
              <label className="grid gap-1.5 text-sm font-medium">
                <div>
                  Who should source this?{" "}
                  <span className="text-destructive">*</span>
                </div>
                <Select
                  value={assignedToId || undefined}
                  onValueChange={(value) =>
                    form.setValue("assignedToId", value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a sourcer" />
                  </SelectTrigger>
                  <SelectContent>
                    {sourcers.map((member: any) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name || member.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sourcers.length === 0 ? (
                  <span className="text-xs font-normal text-destructive">
                    No approved sourcers are available.{" "}
                    {isAdminView && (
                      <Link className="underline" href={`${basePath}/members`}>
                        Manage sourcers
                      </Link>
                    )}
                  </span>
                ) : !assignedToId ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    The sourcer will be notified immediately.
                  </span>
                ) : null}
              </label>
            ) : (
              <p className="self-end pb-2 text-sm text-muted-foreground">
                This request will be sent to the sourcing team.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            isLoading={isSubmitting}
            onClick={() => submitForm(false)}
          >
            Save for later
          </Button>
          <Button
            type="submit"
            className="min-h-11 px-6"
            disabled={canAssign && (!assignedToId || sourcers.length === 0)}
            isLoading={isSubmitting}
          >
            {canAssign ? "Send to sourcer" : "Create request"}
          </Button>
        </div>
      </form>
    </main>
  );
}
