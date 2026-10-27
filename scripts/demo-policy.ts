import type { PrismaClient } from "@prisma/client";
import { redactTelemetry } from "../lib/security/redaction";

type Environment = Record<string, string | undefined>;
export const demoRoles = ["admin", "retailer", "client", "supplier"] as const;
export type DemoRole = (typeof demoRoles)[number];

/** Demo tools never fall back to the application's DATABASE_URL. */
export function assertDemoTarget(env: Environment): string {
  if (!["development", "test"].includes(env.NODE_ENV ?? "") || env.VERCEL || env.VERCEL_ENV) {
    throw new Error("Demo scripts require an explicit local development/test environment and cannot run on a deployment");
  }
  const value = env.DEMO_DATABASE_URL;
  if (!value || value.trim() !== value) throw new Error("DEMO_DATABASE_URL must explicitly select a local fixture database");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("DEMO_DATABASE_URL is not a valid local MongoDB fixture URL"); }
  if (
    url.protocol !== "mongodb:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) ||
    !/^\/shelfaware_(?:demo|test)(?:_[a-z\d]+)*$/i.test(url.pathname) ||
    url.hash
  ) {
    throw new Error("Demo scripts only accept local shelfaware_demo or shelfaware_test fixture databases");
  }
  return value;
}

export function requireDemoPassword(env: Environment, name: string): string {
  const value = env[name];
  if (!value || value.trim() !== value || value.length < 16 || Buffer.byteLength(value) > 72 || /placeholder|change[-_ ]?me|^your[-_ ]/i.test(value) || /^(.)\1+$/.test(value)) {
    throw new Error(`${name} must be supplied securely with 16 or more characters and at most 72 UTF-8 bytes; it is never printed`);
  }
  return value;
}

export function parseDemoRole(args: string[]): DemoRole {
  const value = args.length === 1 && args[0]?.startsWith("--to=") ? args[0].slice(5)
    : args.length === 2 && args[0] === "--to" ? args[1] : undefined;
  if (!value || !(demoRoles as readonly string[]).includes(value)) {
    throw new Error("Choose an explicit --to admin|retailer|client|supplier; there is no default role");
  }
  return value as DemoRole;
}

/** Guard before importing/constructing a client, and pin the validated datasource. */
export async function withDemoDatabase(operation: (prisma: PrismaClient) => Promise<void>, env: Environment = process.env): Promise<void> {
  const datasourceUrl = assertDemoTarget(env);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl });
  try { await operation(prisma); } finally { await prisma.$disconnect(); }
}

export function reportDemoFailure(error: unknown): void {
  console.error("Demo operation failed:", redactTelemetry(error));
  process.exitCode = 1;
}
