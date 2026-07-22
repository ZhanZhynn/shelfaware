"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
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
} from "@/hooks/queries";
import {
  sourcingCaseSchema,
  type SourcingCaseInput,
} from "@/lib/validations/sourcing";

export default function SourcingCaseForm({ basePath = "/sourcing" }: { basePath?: string }) {
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
            {field("size", "Size")}
            {field("material", "Material")}
            {field("variant", "Variant")}
            {field("referenceUrl", "Reference URL", "https://")}
          </CardContent>
        </Card>
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
                      .filter((member: any) =>
                        ["admin", "sourcer"].includes(member.role),
                      )
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
