import { afterEach, describe, expect, it, vi } from "vitest";
import jwtLibrary from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { assertSecureRuntimeSecrets, runtimeSecretNames } from "./runtime-secrets";

// Per-run credentials never become a committed, reusable signing-key example.
const jwt = randomBytes(32).toString("hex");
const cron = randomBytes(32).toString("hex");

describe("runtime secret separation", () => {
  it("allows optional services to be unconfigured", () => {
    expect(() => assertSecureRuntimeSecrets({ NODE_ENV: "production", JWT_SECRET: jwt })).not.toThrow();
  });

  it.each([undefined, "", " ", "short", "placeholder", "your_super_secret_jwt_key_here_change_this_in_production", "unit-test-only-jwt-secret-not-used-by-the-application", "a".repeat(64), ` ${jwt}`])("rejects a missing or unsafe JWT: %s", (JWT_SECRET) => {
    expect(() => assertSecureRuntimeSecrets({ NODE_ENV: "production", JWT_SECRET })).toThrow("JWT_SECRET");
  });

  it.each(runtimeSecretNames.slice(1))("rejects an explicitly configured weak service key: %s", (name) => {
    expect(() => assertSecureRuntimeSecrets({ NODE_ENV: "production", JWT_SECRET: jwt, [name]: "" })).toThrow(name);
    expect(() => assertSecureRuntimeSecrets({ NODE_ENV: "production", JWT_SECRET: jwt, [name]: "weak-service-key" })).toThrow(name);
  });

  it.each(runtimeSecretNames.slice(1))("a service key cannot sign sessions: %s", (name) => {
    expect(() => assertSecureRuntimeSecrets({ NODE_ENV: "production", JWT_SECRET: jwt, [name]: jwt })).toThrow("independent");
  });

  it("rejects reuse between two non-JWT services", () => {
    expect(() => assertSecureRuntimeSecrets({ NODE_ENV: "production", JWT_SECRET: jwt, CRON_SECRET: cron, INTERNAL_API_KEY: cron })).toThrow("independent");
  });

  it("never places secret values in errors", () => {
    const action = () => assertSecureRuntimeSecrets({ NODE_ENV: "production", JWT_SECRET: jwt, CRON_SECRET: jwt });
    expect(action).toThrow("independent");
    try { action(); } catch (error) { expect(String(error)).not.toContain(jwt); }
  });

  it("does not impose production credentials on development fixtures", () => {
    expect(() => assertSecureRuntimeSecrets({ NODE_ENV: "development", JWT_SECRET: "local" })).not.toThrow();
  });

  it("has no build-phase bypass in the credential validator", () => {
    expect(() => assertSecureRuntimeSecrets({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build", JWT_SECRET: "placeholder" })).toThrow();
  });
});

describe("session signing enforces runtime configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  function configure() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", jwt);
    vi.stubEnv("CRON_SECRET", cron);
    vi.stubEnv("MARKETPLACE_SYNC_WORKER_SECRET", undefined);
    vi.stubEnv("INTERNAL_API_KEY", undefined);
  }

  it("rejects old sessions after a signing-key change", async () => {
    configure();
    const { generateToken, verifyToken } = await import("@/utils/auth");
    const token = generateToken("synthetic-user");
    expect(verifyToken(token)).toMatchObject({ userId: "synthetic-user" });
    vi.stubEnv("JWT_SECRET", randomBytes(32).toString("hex"));
    expect(verifyToken(token)).toBeNull();
    expect(verifyToken(generateToken("synthetic-user"))).toMatchObject({ userId: "synthetic-user" });
  });

  it("cannot sign or verify using a reused service secret", async () => {
    configure();
    const { generateToken, verifyToken } = await import("@/utils/auth");
    const token = generateToken("synthetic-user");
    vi.stubEnv("CRON_SECRET", jwt);
    expect(() => generateToken("synthetic-user")).toThrow("independent");
    expect(() => verifyToken(token)).toThrow("independent");
  });

  it("does not accept a forged session signed with the independent cron key", async () => {
    configure();
    const { verifyToken, getSessionFromRequest } = await import("@/utils/auth");
    const forged = jwtLibrary.sign({ userId: "synthetic-admin" }, cron, { expiresIn: "1h" });
    expect(verifyToken(forged)).toBeNull();
    // The unit DB boundary fails this test if an invalid JWT reaches a user lookup.
    await expect(getSessionFromRequest({ cookies: { get: () => ({ value: forged }) } })).resolves.toBeNull();
  });
});
