import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ construct: vi.fn(), disconnect: vi.fn(async () => {}), read: vi.fn(async () => []) }));
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(function (options) {
    m.construct(options);
    return { $disconnect: m.disconnect, user: { findMany: m.read } };
  }),
}));
import { assertDemoTarget, parseDemoRole, requireDemoPassword, withDemoDatabase } from "./demo-policy";

const local = { NODE_ENV: "development", DEMO_DATABASE_URL: "mongodb://127.0.0.1:27017/shelfaware_demo" };
beforeEach(() => vi.clearAllMocks());

describe("demo database policy", () => {
  it.each([
    { ...local, NODE_ENV: undefined },
    { ...local, NODE_ENV: "production" },
    { ...local, VERCEL_ENV: "production" },
    { ...local, VERCEL_ENV: "preview" },
    { ...local, VERCEL: "1" },
    { NODE_ENV: "development", DATABASE_URL: local.DEMO_DATABASE_URL },
    { ...local, DEMO_DATABASE_URL: "mongodb://127.0.0.1:27017/stockly" },
    { ...local, DEMO_DATABASE_URL: "mongodb://127.0.0.1:27017/shelfaware_production" },
    { ...local, DEMO_DATABASE_URL: "mongodb://localhost.attacker.test:27017/shelfaware_demo" },
    { ...local, DEMO_DATABASE_URL: "mongodb+srv://user:PRIVATE_PASSWORD@cluster.example.test/shelfaware_demo" },
    { ...local, DEMO_DATABASE_URL: "mongodb://10.0.0.10/shelfaware_demo" },
    { ...local, DEMO_DATABASE_URL: "mongodb://user:PRIVATE_PASSWORD@" },
  ])("refuses unsafe target before constructing a database client: %j", async (env) => {
    const operation = vi.fn(async () => {});
    await expect(withDemoDatabase(operation, env)).rejects.toThrow(/Demo|DEMO/);
    expect(m.construct).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it("pins local fixture access even when the application DATABASE_URL points elsewhere", async () => {
    await withDemoDatabase(async (prisma) => { await prisma.user.findMany(); }, {
      ...local, DATABASE_URL: "mongodb+srv://user:PRIVATE_PASSWORD@production.example.test/catalog",
    });
    expect(m.construct).toHaveBeenCalledWith({ datasourceUrl: local.DEMO_DATABASE_URL });
    expect(m.read).toHaveBeenCalledOnce();
    expect(m.disconnect).toHaveBeenCalledOnce();
  });

  it("closes the fixture database if an operation fails", async () => {
    await expect(withDemoDatabase(async () => { throw new Error("synthetic failure"); }, local)).rejects.toThrow("synthetic failure");
    expect(m.disconnect).toHaveBeenCalledOnce();
  });

  it.each(["mongodb://localhost/shelfaware_test", "mongodb://[::1]:27017/shelfaware_demo_case1"])("allows explicit local fixtures: %s", (url) => {
    expect(assertDemoTarget({ NODE_ENV: "test", DEMO_DATABASE_URL: url })).toBe(url);
  });

  it("does not echo a rejected URL's credentials", () => {
    const action = () => assertDemoTarget({ ...local, DEMO_DATABASE_URL: "mongodb://user:PRIVATE_PASSWORD@remote.example.test/shelfaware_demo" });
    expect(action).toThrow();
    try {
      action();
    } catch (error) { expect(String(error)).not.toContain("PRIVATE_PASSWORD"); }
  });
});

describe("demo identities and passwords", () => {
  it.each([[], ["admin"], ["--to", "unknown"], ["--to", "client", "--to", "admin"], ["--to="]].map((args) => ({ args })))("requires exactly one explicit role: $args", ({ args }) => {
    expect(() => parseDemoRole(args)).toThrow("no default role");
  });
  it("requires an explicit admin fixture choice", () => {
    expect(parseDemoRole(["--to", "admin"])).toBe("admin");
    expect(parseDemoRole(["--to=supplier"])).toBe("supplier");
  });
  it.each([undefined, "", "short", "your_demo_password_change_me", "x".repeat(32), "界".repeat(25)])("refuses missing/unsafe fixture credentials: %s", (value) => {
    expect(() => requireDemoPassword({ DEMO_USER_PASSWORD: value }, "DEMO_USER_PASSWORD")).toThrow("DEMO_USER_PASSWORD");
  });
  it("accepts a supplied fixture password without logging it", () => {
    const fixturePassword = randomBytes(24).toString("hex");
    expect(requireDemoPassword({ DEMO_USER_PASSWORD: fixturePassword }, "DEMO_USER_PASSWORD")).toBe(fixturePassword);
  });
});

it.each(["create-demo-accounts.ts", "update-demo-user.ts", "verify-demo-accounts.ts", "update-demo-supplier-description.ts"])("the actual CLI refuses production: %s", (script) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.resolve("scripts", script)], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      DATABASE_URL: "mongodb://user:PRIVATE_PASSWORD@127.0.0.1:1/production",
      DEMO_DATABASE_URL: local.DEMO_DATABASE_URL,
    },
    encoding: "utf8",
    timeout: 5_000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Demo scripts require an explicit local");
  expect(`${result.stdout}${result.stderr}`).not.toContain("PRIVATE_PASSWORD");
});
