"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter, useSearchParams } from "next/navigation";
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
  useSourcingMembers,
  useSourcingWorkspaces,
  useSourcingDuplicates,
  useSourcingTemplates,
  useCreateSourcingTemplate,
} from "@/hooks/queries";
import {
  sourcingCaseSchema,
  type SourcingCaseInput,
} from "@/lib/validations/sourcing";

export default function SourcingCaseForm({
  basePath = "/sourcing",
}: {
  basePath?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { data: workspaces = [] } = useSourcingWorkspaces();
  const form = useForm<SourcingCaseInput>({
    resolver: zodResolver(sourcingCaseSchema),
    defaultValues: {
      workspaceId: params.get("workspaceId") || "",
      title: "",
      photoUrls: [],
      route: "yiwu",
    },
  });
  const workspaceId = form.watch("workspaceId");
  const canAssign = !!workspaces.find(
    (workspace: any) => workspace.id === workspaceId,
  )?.canAssign;
  const { data: members = [] } = useSourcingMembers(workspaceId, canAssign);
  const create = useCreateSourcingCase();
  const createTemplate = useCreateSourcingTemplate();
  const [templateName, setTemplateName] = useState("");
  const { data: templates = [] } = useSourcingTemplates(workspaceId);
  const title = form.watch("title") || "";
  const { data: duplicates = [] } = useSourcingDuplicates(workspaceId, title);
  useEffect(() => {
    if (!workspaceId && workspaces[0]?.id)
      form.setValue("workspaceId", workspaces[0].id);
  }, [form, workspaceId, workspaces]);
  const submit = async (values: SourcingCaseInput, assign: boolean) => {
    const result: any = await create.mutateAsync({
      ...values,
      assignedToId: assign ? values.assignedToId : undefined,
    });
    router.push(`${basePath}/${result.id}`);
  };
  const field = (
    name: keyof SourcingCaseInput,
    label: string,
    placeholder?: string,
  ) => (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <Input placeholder={placeholder} {...form.register(name as any)} />
      {form.formState.errors[name] && (
        <span className="text-xs text-destructive">
          {String(form.formState.errors[name]?.message)}
        </span>
      )}
    </label>
  );
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">New sourcing case</h1>
        <p className="text-muted-foreground">
          One product per request. Add the details a sourcer needs to quote it.
        </p>
      </div>
      <form
        className="space-y-6"
        onSubmit={form.handleSubmit((values) => submit(values, false))}
      >
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              Workspace
              <Select
                value={workspaceId}
                onValueChange={(value) => form.setValue("workspaceId", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace: any) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {field(
              "title",
              "Product/request name",
              "e.g. Linen storage basket",
            )}
            {templates.length > 0 && (
              <label className="grid gap-1 text-sm font-medium">
                Start from template
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
                    <SelectValue placeholder="Choose a saved template" />
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
            {field("size", "Size")}
            {field("material", "Material")}
            {field("variant", "Variant")}
            {field("requestedQuantity", "Requested quantity", "number")}
            {field("targetUnitPriceMyr", "Target unit cost (RM)", "number")}
            {field("referenceUrl", "Reference URL", "https://")}
          </CardContent>
        </Card>
        {duplicates.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Possible duplicate requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {duplicates.map((item: any) => (
                <p key={item.id}>
                  <span className="font-medium">{item.title}</span>
                  <span className="ml-2 capitalize text-muted-foreground">
                    {item.stage.replaceAll("_", " ")}
                  </span>
                </p>
              ))}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Specification</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-1 text-sm font-medium">
              Photo URLs, one per line
              <Textarea
                {...form.register("photoUrls", {
                  setValueAs: (value) =>
                    String(value)
                      .split("\n")
                      .map((url) => url.trim())
                      .filter(Boolean),
                })}
                placeholder="https://..."
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Specifications
              <Textarea {...form.register("specifications")} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Notes
              <Textarea {...form.register("notes")} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Route
              <Select
                value={form.watch("route")}
                onValueChange={(value: "yiwu" | "other") =>
                  form.setValue("route", value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yiwu">Yiwu</SelectItem>
                  <SelectItem value="other">Other supplier</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {canAssign && (
              <label className="grid gap-1 text-sm font-medium">
                Assign to
                <Select
                  value={form.watch("assignedToId") || "unassigned"}
                  onValueChange={(value) =>
                    form.setValue(
                      "assignedToId",
                      value === "unassigned" ? null : value,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Save without assignment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
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
            )}
          </CardContent>
        </Card>
        <div className="flex justify-end gap-3">
          <div className="flex gap-2">
            <Input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Template name"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!workspaceId || !templateName.trim()}
              isLoading={createTemplate.isPending}
              onClick={async () => {
                const values = form.getValues();
                await createTemplate.mutateAsync({
                  workspaceId,
                  name: templateName,
                  data: {
                    title: values.title,
                    description: values.description,
                    size: values.size,
                    material: values.material,
                    variant: values.variant,
                    specifications: values.specifications,
                    requestedQuantity: values.requestedQuantity,
                    targetUnitPriceMyr: values.targetUnitPriceMyr,
                    route: values.route,
                  },
                });
                setTemplateName("");
              }}
            >
              Save template
            </Button>
          </div>
          <Button type="submit" variant="outline" isLoading={create.isPending}>
            Save draft
          </Button>
          {canAssign && (
            <Button
              type="button"
              isLoading={create.isPending}
              disabled={!form.watch("assignedToId")}
              onClick={form.handleSubmit((values) => submit(values, true))}
            >
              Create &amp; Assign
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}
