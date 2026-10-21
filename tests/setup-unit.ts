import { afterEach, beforeEach, expect, vi } from "vitest";

const isolation = vi.hoisted(() => ({ attempts: [] as string[] }));

// Importing prisma/client.ts otherwise calls $connect() at module load. Tests
// needing a database boundary must provide their own explicit vi.mock factory.
vi.mock("@/prisma/client", () => {
  const forbidden = (operation: string) => async () => {
    isolation.attempts.push(operation);
    throw new Error(`Unmocked database operation in unit test: ${operation}`);
  };
  const prisma = new Proxy({}, {
    get(_target, model) {
      if (typeof model !== "string" || model === "then") return undefined;
      if (model.startsWith("$")) return forbidden(model);
      return new Proxy({}, {
        get(_model, operation) {
          return typeof operation === "string" ? forbidden(`${model}.${operation}`) : undefined;
        },
      });
    },
  });
  return { default: prisma, prisma };
});

beforeEach(() => {
  isolation.attempts.length = 0;
  vi.stubGlobal("fetch", async () => {
    isolation.attempts.push("fetch");
    throw new Error("Unmocked HTTP request in unit test; provide a synthetic fetch response");
  });
});

afterEach(() => {
  // Fail even when application code catches an accidental boundary call.
  const attempted = [...isolation.attempts];
  vi.unstubAllGlobals();
  expect(attempted, "Unit tests must explicitly mock database and HTTP boundaries").toEqual([]);
});
