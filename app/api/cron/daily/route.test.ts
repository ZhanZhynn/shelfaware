import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

it("accepts the current independent cron key and rejects the previous key without calling jobs", async () => {
  const oldKey = randomBytes(32).toString("hex");
  const currentKey = randomBytes(32).toString("hex");
  vi.stubEnv("CRON_SECRET", currentKey);
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const request = (secret: string) => new NextRequest("https://app.example.test/api/cron/daily", { headers: { authorization: `Bearer ${secret}` } });
  expect((await GET(request(oldKey))).status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await GET(request(currentKey))).status).toBe(200);
  expect(fetchMock).toHaveBeenCalled();
  for (const [, options] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
    expect(options.headers).toMatchObject({ authorization: `Bearer ${currentKey}` });
  }
});
