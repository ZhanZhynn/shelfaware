import { describe, expect, it } from "vitest";
import { retryCsvCommit, retryCsvDraft, startNewCsvImport } from "./csv-import-session";

describe("CSV import idempotency sessions", () => {
  it("keeps keys for retries and replaces both keys for a deliberate new import", () => {
    let number = 0;
    const createKey = () => `key-${++number}`;
    const first = startNewCsvImport(createKey);
    expect(retryCsvDraft(first, createKey)).toBe("key-1");
    const committing = { ...first, commitKey: retryCsvCommit(first, createKey) };
    expect(retryCsvCommit(committing, createKey)).toBe("key-2");
    expect(startNewCsvImport(createKey)).toEqual({ draftKey: "key-3", commitKey: null });
  });
});
