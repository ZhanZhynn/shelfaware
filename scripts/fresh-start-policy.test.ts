import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertFreshStartAllowed, assertResetAllowed, getDatabaseTarget } from "./fresh-start-policy";

describe("fresh-start policy", () => {
  const localTarget = getDatabaseTarget("mongodb://user:secret@localhost:27017/ShelfAware?authSource=admin");
  const remoteTarget = getDatabaseTarget("mongodb+srv://user:secret@cluster.example.com/shelfaware?retryWrites=true");

  it("normalizes and redacts the target", () => {
    expect(localTarget).toMatchObject({ host: "localhost:27017", database: "ShelfAware", display: "mongodb://localhost:27017/ShelfAware", isLocalOrDev: true });
    expect(remoteTarget.display).toBe("mongodb+srv://cluster.example.com/shelfaware");
    expect(remoteTarget.display).not.toContain("secret");
  });

  it("allows non-production reset only for recognized local/dev targets with all acknowledgements", () => {
    const env = {
      ALLOW_RESET: "yes",
      RESET_CONFIRMATION: "RESET:mongodb://localhost:27017/ShelfAware:ShelfAware",
      DATA_RESET_BACKUP_ACKNOWLEDGEMENT: "BACKUP_VERIFIED:mongodb://localhost:27017/ShelfAware",
      DATA_RESET_MAINTENANCE_ACKNOWLEDGEMENT: "MAINTENANCE_QUIESCED:mongodb://localhost:27017/ShelfAware",
    };
    expect(() => assertResetAllowed(env, localTarget, false)).not.toThrow();
    expect(() => assertResetAllowed({ ...env, DATA_RESET_BACKUP_ACKNOWLEDGEMENT: "yes" }, localTarget, false)).toThrow("DATA_RESET_BACKUP_ACKNOWLEDGEMENT");
  });

  it("fails closed for unknown remote targets and requires an exact production confirmation", () => {
    expect(() => assertResetAllowed({}, remoteTarget, false)).toThrow("ALLOW_PRODUCTION_RESET");
    expect(() => assertResetAllowed({ ALLOW_PRODUCTION_RESET: "yes", PRODUCTION_RESET_CONFIRMATION: "RESET_PRODUCTION:mongodb+srv://cluster.example.com/shelfaware:shelfaware" }, remoteTarget, false)).toThrow("DATA_RESET_BACKUP_ACKNOWLEDGEMENT");
  });

  it("requires a target-bound confirmation before marketplace snapshots can be deleted", () => {
    const env = {
      ALLOW_RESET: "yes",
      RESET_CONFIRMATION: "RESET:mongodb://localhost:27017/ShelfAware:ShelfAware",
      DATA_RESET_BACKUP_ACKNOWLEDGEMENT: "BACKUP_VERIFIED:mongodb://localhost:27017/ShelfAware",
      DATA_RESET_MAINTENANCE_ACKNOWLEDGEMENT: "MAINTENANCE_QUIESCED:mongodb://localhost:27017/ShelfAware",
    };
    expect(() => assertResetAllowed(env, localTarget, false, true)).toThrow("MARKETPLACE_RESET_CONFIRMATION");
    expect(() => assertResetAllowed({ ...env, MARKETPLACE_RESET_CONFIRMATION: "RESET_MARKETPLACE:mongodb://localhost:27017/ShelfAware" }, localTarget, false, true)).not.toThrow();
  });

  it("allows the irreversible no-backup acknowledgement only for local/dev marketplace resets", () => {
    const env = {
      ALLOW_RESET: "yes",
      RESET_CONFIRMATION: "RESET:mongodb://localhost:27017/ShelfAware:ShelfAware",
      DATA_RESET_IRREVERSIBLE_NO_BACKUP_CONFIRMATION: "IRREVERSIBLE_NO_BACKUP:mongodb://localhost:27017/ShelfAware",
      DATA_RESET_MAINTENANCE_ACKNOWLEDGEMENT: "MAINTENANCE_QUIESCED:mongodb://localhost:27017/ShelfAware",
      MARKETPLACE_RESET_CONFIRMATION: "RESET_MARKETPLACE:mongodb://localhost:27017/ShelfAware",
    };
    expect(() => assertResetAllowed(env, localTarget, false, true)).not.toThrow();
    expect(() => assertResetAllowed(env, localTarget, false)).toThrow("no-backup reset");
    expect(() => assertResetAllowed({ ...env, NODE_ENV: "production" }, localTarget, false, true)).toThrow("no-backup reset");
    expect(() => assertResetAllowed({
      ...env,
      DATA_RESET_IRREVERSIBLE_NO_BACKUP_CONFIRMATION: "IRREVERSIBLE_NO_BACKUP:mongodb+srv://cluster.example.com/shelfaware",
    }, remoteTarget, false, true)).toThrow("no-backup reset");
  });

  it("requires an explicit target, account, and workspace confirmation for bootstrap", () => {
    expect(() => assertFreshStartAllowed({ ALLOW_BOOTSTRAP: "yes", BOOTSTRAP_CONFIRMATION: "BOOTSTRAP:mongodb://localhost:27017/ShelfAware:user-1:Jun Workspace" }, localTarget, false, "BOOTSTRAP", "user-1:Jun Workspace")).not.toThrow();
    expect(() => assertFreshStartAllowed({}, remoteTarget, false, "BOOTSTRAP", "user-1:Jun Workspace")).toThrow("ALLOW_PRODUCTION_BOOTSTRAP");
  });

  it("allows dry-run inspection without confirmations", () => {
    expect(() => assertResetAllowed({}, remoteTarget, true)).not.toThrow();
  });

  it("does not expose unguarded partial-delete package commands", () => {
    const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts).not.toHaveProperty("script:delete-all-suppliers");
    expect(packageJson.scripts).not.toHaveProperty("script:delete-all-categories");
  });

  it("gives the transactional reset enough time to remove marketplace snapshots", () => {
    const resetScript = readFileSync(fileURLToPath(new URL("./reset-business-data.ts", import.meta.url)), "utf8");
    expect(resetScript).toContain("const resetTransactionOptions = { maxWait: 10_000, timeout: 120_000 }");
    expect(resetScript).toContain("}, resetTransactionOptions);");
  });
});
