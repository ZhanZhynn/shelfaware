"use client";

import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type VariantDraft = {
  clientKey: string;
  imageKey?: string;
  size: string;
  material: string;
  colour: string;
  requestedQuantity: number;
  marketPriceMyr: string;
  requestQuote: boolean;
  productUrl: string;
  remarks: string;
};

type Option = { id: string; value: string; explanation: string };
type Axis = { id: string; name: string; options: Option[] };

const id = () => crypto.randomUUID();
const emptyOption = (): Option => ({ id: id(), value: "", explanation: "" });
const defaultAxis = (name: string): Axis => ({
  id: id(),
  name,
  options: [emptyOption()],
});

export const newVariantDraft = (): VariantDraft => ({
  clientKey: id(),
  size: "",
  material: "",
  colour: "",
  requestedQuantity: 1,
  marketPriceMyr: "",
  requestQuote: true,
  productUrl: "",
  remarks: "",
});

const valuesFor = (axis: Axis) =>
  axis.options.filter((option) => option.value.trim());
const keyFor = (options: Option[]) =>
  options.map((option) => option.id).join(":");

export function SourcingVariantBuilder({
  variants,
  images,
  onChange,
  onImageChange,
}: {
  variants: VariantDraft[];
  images: Record<string, File | undefined>;
  onChange: (variants: VariantDraft[]) => void;
  onImageChange: (clientKey: string, file?: File) => void;
}) {
  const [axes, setAxes] = useState<Axis[]>([defaultAxis("Colour")]);
  const [initialized, setInitialized] = useState(false);
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [bulkMarketPrice, setBulkMarketPrice] = useState("");
  const [bulkMarketplaceLink, setBulkMarketplaceLink] = useState("");
  const [bulkQuoteScope, setBulkQuoteScope] = useState(true);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>(
    {},
  );
  const [optionErrors, setOptionErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (
      initialized ||
      !variants.some(
        (variant) => variant.size || variant.material || variant.colour,
      )
    )
      return;
    const fields = ["size", "material", "colour"] as const;
    const next = fields
      .map((field, index) => {
        const values = [
          ...new Set(variants.map((variant) => variant[field]).filter(Boolean)),
        ];
        return values.length
          ? {
              ...defaultAxis(
                index === 0
                  ? "Colour"
                  : index === 1
                    ? "Variation 2"
                    : "Variation 3",
              ),
              options: values.map((value) => ({
                id: id(),
                value,
                explanation: "",
              })),
            }
          : null;
      })
      .filter(Boolean) as Axis[];
    if (next.length) setAxes(next);
    setInitialized(true);
  }, [initialized, variants]);

  const generate = (nextAxes: Axis[]) => {
    const active = nextAxes.map(valuesFor);
    if (!active.length || active.some((options) => !options.length)) return [];
    const combinations = active.reduce<Option[][]>(
      (rows, options) =>
        rows.flatMap((row) => options.map((option) => [...row, option])),
      [[]],
    );
    const current = new Map(
      variants.map((variant) => [variant.clientKey, variant]),
    );
    return combinations.map((options) => {
      const clientKey = keyFor(options);
      const existing = current.get(clientKey);
      return {
        ...(existing || newVariantDraft()),
        clientKey,
        imageKey: options[0]?.id,
        size: options[0]?.value || "",
        material: options[1]?.value || "",
        colour: options[2]?.value || "",
      };
    });
  };
  const setAxis = (next: Axis[], preserveBlankOptionRows = true) => {
    // Prevent the legacy-data hydration effect from replacing live option IDs mid-typing.
    setInitialized(true);
    setAxes(next);
    const nextVariants = generate(next);
    const blankOptionIds = new Set(
      next.flatMap((axis) =>
        axis.options
          .filter((option) => !option.value.trim())
          .map((option) => option.id),
      ),
    );
    const retainedRows = preserveBlankOptionRows
      ? variants.filter((variant) =>
          variant.clientKey
            .split(":")
            .some((optionId) => blankOptionIds.has(optionId)),
        )
      : [];
    const nextByKey = new Map(
      nextVariants.map((variant) => [variant.clientKey, variant]),
    );
    const retainedKeys = new Set(
      retainedRows.map((variant) => variant.clientKey),
    );
    const mergedRows = [
      ...variants
        .map(
          (variant) =>
            nextByKey.get(variant.clientKey) ||
            (retainedKeys.has(variant.clientKey) ? variant : null),
        )
        .filter((variant): variant is VariantDraft => variant !== null),
      ...nextVariants.filter(
        (variant) =>
          !variants.some(
            (existing) => existing.clientKey === variant.clientKey,
          ),
      ),
    ];
    // A temporarily blank option is validation state, not an instruction to discard its row data.
    if (mergedRows.length) onChange(mergedRows);
  };
  const updateVariant = (clientKey: string, patch: Partial<VariantDraft>) =>
    onChange(
      variants.map((variant) =>
        variant.clientKey === clientKey ? { ...variant, ...patch } : variant,
      ),
    );
  const updateOption = (axisId: string, optionId: string, value: string) => {
    const hasImage = !!images[optionId] || !!imagePreviews[optionId];
    setOptionErrors((current) => ({
      ...current,
      [optionId]: hasImage && !value.trim(),
    }));
    const next = axes.map((axis) => {
      if (axis.id !== axisId) return axis;
      const options = axis.options.map((option) =>
        option.id === optionId ? { ...option, value } : option,
      );
      // Shopee-style entry: keep a new blank option available after the last value is filled.
      if (value.trim() && !options.some((option) => !option.value.trim()))
        options.push(emptyOption());
      return { ...axis, options };
    });
    setAxis(next);
  };
  const applyToAll = () =>
    onChange(
      variants.map((variant) => ({
        ...variant,
        requestQuote: bulkQuoteScope,
        requestedQuantity: bulkQuantity
          ? Number(bulkQuantity) || 1
          : variant.requestedQuantity,
        marketPriceMyr: bulkMarketPrice || variant.marketPriceMyr,
        productUrl: bulkMarketplaceLink || variant.productUrl,
      })),
    );
  const chooseImage = (imageKey: string, file?: File) => {
    if (file)
      setImagePreviews((current) => ({
        ...current,
        [imageKey]: URL.createObjectURL(file),
      }));
    if (
      file &&
      !axes.some((axis) =>
        axis.options.some(
          (option) => option.id === imageKey && option.value.trim(),
        ),
      )
    )
      setOptionErrors((current) => ({ ...current, [imageKey]: true }));
    onImageChange(imageKey, file);
  };
  const removeOption = (axisId: string, optionId: string) => {
    if (images[optionId] || imagePreviews[optionId]) {
      setOptionErrors((current) => ({ ...current, [optionId]: true }));
      return;
    }
    setAxis(
      axes.map((entry) =>
        entry.id !== axisId
          ? entry
          : {
              ...entry,
              options: entry.options.filter((item) => item.id !== optionId),
            },
      ),
      false,
    );
  };
  const hasCombinations =
    axes.length > 0 && axes.every((axis) => valuesFor(axis).length > 0);
  const firstOption = axes[0]?.options[0];
  const placeholderVariant =
    axes.length === 1 && firstOption
      ? variants.find((variant) => variant.imageKey === firstOption.id) || {
          ...newVariantDraft(),
          clientKey: `placeholder:${firstOption.id}`,
          imageKey: firstOption.id,
        }
      : null;
  const displayVariants = hasCombinations
    ? variants
    : placeholderVariant
      ? [placeholderVariant]
      : [];
  const optionHasRowData = (optionId: string) =>
    variants.some(
      (variant) =>
        variant.clientKey.split(":").includes(optionId) &&
        (!!variant.marketPriceMyr ||
          !!variant.productUrl ||
          !!variant.remarks ||
          variant.requestedQuantity !== 1 ||
          !!images[optionId] ||
          !!imagePreviews[optionId]),
    );

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/20 p-3 text-sm font-medium">
        Variations
      </div>
      {axes.map((axis, axisIndex) => (
        <section key={axis.id} className="rounded-md bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">
              Variation {axisIndex + 1}
            </span>
            {axes.length > 1 && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() =>
                  setAxis(
                    axes.filter((entry) => entry.id !== axis.id),
                    false,
                  )
                }
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Input
            className="max-w-72"
            value={axis.name}
            onChange={(event) =>
              setAxis(
                axes.map((entry) =>
                  entry.id === axis.id
                    ? { ...entry, name: event.target.value }
                    : entry,
                ),
              )
            }
            placeholder="Variation name"
          />
          <p className="mb-2 mt-3 text-xs font-medium">Options</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {axis.options.map((option) => (
              <div key={option.id} className="grid gap-1">
                <div className="flex gap-1">
                  <Input
                    className={
                      optionErrors[option.id] ||
                      (!option.value.trim() && optionHasRowData(option.id))
                        ? "border-destructive"
                        : ""
                    }
                    value={option.value}
                    placeholder="Option"
                    onChange={(event) =>
                      updateOption(axis.id, option.id, event.target.value)
                    }
                  />
                  <Input
                    value={option.explanation}
                    placeholder="Add an explanation"
                    onChange={(event) =>
                      setAxis(
                        axes.map((entry) =>
                          entry.id !== axis.id
                            ? entry
                            : {
                                ...entry,
                                options: entry.options.map((item) =>
                                  item.id === option.id
                                    ? {
                                        ...item,
                                        explanation: event.target.value,
                                      }
                                    : item,
                                ),
                              },
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeOption(axis.id, option.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {(optionErrors[option.id] ||
                  (!option.value.trim() && optionHasRowData(option.id))) && (
                  <p className="text-xs text-destructive">
                    This field cannot be empty.
                  </p>
                )}
              </div>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() =>
              setAxis(
                axes.map((entry) =>
                  entry.id === axis.id
                    ? { ...entry, options: [...entry.options, emptyOption()] }
                    : entry,
                ),
              )
            }
          >
            <Plus className="h-3 w-3" /> Add option
          </Button>
        </section>
      ))}
      {axes.length < 3 && (
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setAxis([...axes, defaultAxis(`Variation ${axes.length + 1}`)])
          }
        >
          <Plus className="h-4 w-4" /> Add variation
        </Button>
      )}
      <div className="border-t pt-4">
        <p className="mb-2 text-sm font-medium">Variation list</p>
        {displayVariants.length > 0 && (
          <>
            <div className="mb-3 grid gap-2 rounded border bg-muted/30 p-2 sm:grid-cols-2 lg:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="flex items-center gap-2 text-sm">
                <Switch
                  checked={bulkQuoteScope}
                  onCheckedChange={setBulkQuoteScope}
                />
                <span>Quote?</span>
              </div>
              <Input
                type="number"
                min="1"
                placeholder="Quantity"
                value={bulkQuantity}
                onChange={(event) => setBulkQuantity(event.target.value)}
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Market price (RM)"
                value={bulkMarketPrice}
                onChange={(event) => setBulkMarketPrice(event.target.value)}
              />
              <Input
                type="url"
                placeholder="Marketplace link"
                value={bulkMarketplaceLink}
                onChange={(event) => setBulkMarketplaceLink(event.target.value)}
              />
              <Button type="button" size="sm" onClick={applyToAll}>
                Apply to all
              </Button>
            </div>
            <div className="overflow-x-auto border">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    {axes.map((axis) => (
                      <th key={axis.id} className="border p-2">
                        {axis.name || "Variation"}
                      </th>
                    ))}
                    <th className="border p-2">Quote?</th>
                    <th className="border p-2">Quantity</th>
                    <th className="border p-2">Market price (RM)</th>
                    <th className="border p-2">Marketplace link</th>
                    <th className="border p-2">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {displayVariants.map((variant) => {
                    const image = variant.imageKey
                      ? images[variant.imageKey]
                      : undefined;
                    const preview = variant.imageKey
                      ? imagePreviews[variant.imageKey]
                      : undefined;
                    const currentPrimaryValue =
                      axes[0]?.options.find(
                        (option) => option.id === variant.imageKey,
                      )?.value ?? variant.size;
                    return (
                      <tr
                        key={variant.clientKey}
                        className={
                          variant.requestQuote
                            ? ""
                            : "bg-muted/30 text-muted-foreground"
                        }
                      >
                        <td className="min-w-28 border p-2">
                          <p className="mb-2 font-medium">
                            {currentPrimaryValue}
                          </p>
                          <div className="group relative h-16 w-16">
                            <label className="flex h-full w-full cursor-pointer items-center justify-center overflow-hidden border border-dashed bg-background">
                              {preview || image ? (
                                <img
                                  src={preview || URL.createObjectURL(image!)}
                                  alt={currentPrimaryValue || "Variant image"}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <ImagePlus className="h-5 w-5 text-muted-foreground" />
                              )}
                              <input
                                className="sr-only"
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                onChange={(event) =>
                                  variant.imageKey &&
                                  chooseImage(
                                    variant.imageKey,
                                    event.target.files?.[0],
                                  )
                                }
                              />
                            </label>
                            {(preview || image) && variant.imageKey && (
                              <Button
                                type="button"
                                size="icon"
                                variant="destructive"
                                className="absolute -right-2 -top-2 h-6 w-6 opacity-0 shadow group-hover:opacity-100"
                                onClick={() => {
                                  setImagePreviews((current) => {
                                    const next = { ...current };
                                    delete next[variant.imageKey!];
                                    return next;
                                  });
                                  onImageChange(variant.imageKey!, undefined);
                                  setOptionErrors((current) => ({
                                    ...current,
                                    [variant.imageKey!]: false,
                                  }));
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                        {axes.slice(1).map((axis, index) => (
                          <td key={axis.id} className="border p-2">
                            {index === 0 ? variant.material : variant.colour}
                          </td>
                        ))}
                        <td className="border p-2">
                          <Switch
                            checked={variant.requestQuote}
                            onCheckedChange={(checked) =>
                              updateVariant(variant.clientKey, {
                                requestQuote: checked,
                              })
                            }
                          />
                        </td>
                        <td className="border p-2">
                          <Input
                            type="number"
                            min="1"
                            value={variant.requestedQuantity}
                            onChange={(event) =>
                              updateVariant(variant.clientKey, {
                                requestedQuantity:
                                  Number(event.target.value) || 1,
                              })
                            }
                          />
                        </td>
                        <td className="border p-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={variant.marketPriceMyr}
                            onChange={(event) =>
                              updateVariant(variant.clientKey, {
                                marketPriceMyr: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="border p-2">
                          <Input
                            type="url"
                            placeholder="Optional URL"
                            value={variant.productUrl}
                            onChange={(event) =>
                              updateVariant(variant.clientKey, {
                                productUrl: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="border p-2">
                          <Textarea
                            rows={2}
                            placeholder="Optional remarks"
                            value={variant.remarks}
                            onChange={(event) =>
                              updateVariant(variant.clientKey, {
                                remarks: event.target.value,
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
