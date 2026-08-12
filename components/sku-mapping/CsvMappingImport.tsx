"use client";
import { useRef, useState } from "react";
import axios from "axios";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  retryCsvCommit,
  retryCsvDraft,
  startNewCsvImport,
} from "./csv-import-session";

type Row = {
  rowNumber: number;
  salesSkuCode: string;
  offerKey: string | null;
  validationSnapshot: { valid: boolean; errors: string[] };
  mappingResult: unknown;
};
type Batch = {
  id: string;
  filename: string;
  status: string;
  validationSnapshot: { valid: boolean; errors: string[] };
  rows: Row[];
};
const key = () => crypto.randomUUID().replaceAll("-", "");

export function CsvMappingImport() {
  const client = useQueryClient();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const draftKey = useRef<string | null>(null);
  const commitKey = useRef<string | null>(null);
  const commit = useMutation({
    mutationFn: async () => {
      commitKey.current = retryCsvCommit(
        { draftKey: draftKey.current, commitKey: commitKey.current },
        key,
      );
      return (
        await axios.post(
          "/api/inventory/sku-mapping/csv",
          {
            action: "commit",
            batchId: batch?.id,
            idempotencyKey: commitKey.current,
          },
          { withCredentials: true },
        )
      ).data as Batch;
    },
    onSuccess: (result) => {
      setBatch(result);
      client.invalidateQueries({ queryKey: ["skuMapping"] });
    },
    onError: (reason) =>
      setError(
        axios.isAxiosError(reason)
          ? (reason.response?.data?.error ?? "Could not commit the CSV draft.")
          : "Could not commit the CSV draft.",
      ),
  });
  const upload = async (file: File) => {
    setLoading(true);
    setError("");
    try {
      draftKey.current = retryCsvDraft(
        { draftKey: draftKey.current, commitKey: commitKey.current },
        key,
      );
      const csv = await file.text();
      const result = await axios.post(
        "/api/inventory/sku-mapping/csv",
        {
          action: "create-draft",
          csv,
          filename: file.name,
          idempotencyKey: draftKey.current,
        },
        { withCredentials: true },
      );
      setBatch(result.data);
      draftKey.current = null;
      commitKey.current = null;
    } catch (reason) {
      setError(
        axios.isAxiosError(reason)
          ? (reason.response?.data?.error ?? "Could not validate the CSV.")
          : "Could not validate the CSV.",
      );
    } finally {
      setLoading(false);
    }
  };
  const valid = Boolean(
    batch?.validationSnapshot.valid &&
    batch.rows.every((row) => row.validationSnapshot.valid),
  );
  return (
    <section className="rounded-lg border p-4">
      <h2 className="font-semibold">CSV mapping import</h2>
      <p className="text-sm text-muted-foreground">
        Upload creates a server-side draft only. Review all rows before the
        irreversible confirmed-mapping commit.
      </p>
       <Input
        className="mt-3 max-w-md"
        type="file"
        accept=".csv,text/csv"
        disabled={loading || commit.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.currentTarget.value = "";
        }}
        />
      {batch && (
        <Button
          className="mt-3"
          type="button"
          variant="outline"
          disabled={loading || commit.isPending}
          onClick={() => {
            const session = startNewCsvImport(key);
            draftKey.current = session.draftKey;
            commitKey.current = session.commitKey;
            setBatch(null);
            setError("");
          }}
        >
          Start new import
        </Button>
      )}
      {batch && (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            <strong>{batch.filename}</strong>: {batch.rows.length} row(s),{" "}
            {valid ? "ready to commit" : "requires changes"}.
          </p>
          {batch.validationSnapshot.errors.map((value) => (
            <p key={value} className="text-destructive">
              {value}
            </p>
          ))}
          <div className="max-h-48 space-y-1 overflow-auto">
            {batch.rows.map((row) => (
              <div key={row.rowNumber} className="rounded bg-muted p-2">
                Row {row.rowNumber}:{" "}
                <code>{row.offerKey ?? "unresolved offer"}</code> to{" "}
                {row.salesSkuCode} {row.mappingResult ? "(committed)" : ""}
                {row.validationSnapshot.errors.map((value) => (
                  <p key={value} className="text-destructive">
                    {value}
                  </p>
                ))}
              </div>
            ))}
          </div>
          {batch.status === "draft" && (
            <Button
              disabled={!valid || commit.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "Commit every reviewed CSV row? This creates confirmed mappings and cannot be undone; use corrections for later changes.",
                  )
                )
                  commit.mutate();
              }}
            >
              {commit.isPending ? "Committing..." : "Commit confirmed mappings"}
            </Button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
