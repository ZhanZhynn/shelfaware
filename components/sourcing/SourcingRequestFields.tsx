"use client";

import type { ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SourcingCaseInput } from "@/lib/validations/sourcing";

export function SourcingRequestFields({
  form,
  photos,
  workspace,
  assignee,
  footer,
}: {
  form: UseFormReturn<SourcingCaseInput>;
  photos: ReactNode;
  workspace: ReactNode;
  assignee?: ReactNode;
  footer: ReactNode;
}) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle>Request basics</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <label className="grid gap-1.5 text-sm font-medium"><span>What should we source? <span className="text-destructive">*</span></span><Input placeholder="e.g. Linen storage basket" {...form.register("title")} /></label>
            <label className="grid gap-1.5 text-sm font-medium">How many do you need?<Input type="number" min="1" placeholder="Optional" {...form.register("requestedQuantity")} /></label>
          </div>
          {photos}
          <label className="grid gap-1.5 text-sm font-medium">Tell us what matters most<Textarea rows={3} placeholder="Example: Must be foldable, natural colour, similar to the photo. Need it before Hari Raya." {...form.register("specifications")} /></label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Add more details <span className="ml-1 text-sm font-normal text-muted-foreground">Optional, but useful for a better quote</span></CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {workspace}
          <label className="grid gap-1.5 text-sm font-medium">Target unit cost (RM)<Input type="number" min="0" placeholder="Optional" {...form.register("targetUnitPriceMyr")} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Size or dimensions<Input placeholder="e.g. 30 x 20 cm" {...form.register("size")} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Material<Input placeholder="e.g. linen, bamboo, PP plastic" {...form.register("material")} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Colour, style, or variant<Input placeholder="Optional" {...form.register("variant")} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Product link<Input placeholder="Paste a Shopee, Lazada, or website link" {...form.register("referenceUrl")} /></label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Extra notes<Textarea rows={3} placeholder="Budget, packaging, quality, delivery, or supplier requirements" {...form.register("notes")} /></label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Send request</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">Route<Select value={form.watch("route")} onValueChange={(value: "yiwu" | "other") => form.setValue("route", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yiwu">Yiwu</SelectItem><SelectItem value="other">Other supplier</SelectItem></SelectContent></Select></label>
          {assignee}
        </CardContent>
      </Card>
      {footer}
    </>
  );
}
