import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  getSessionFromRequest,
  withRateLimit,
  workspaceTransaction,
  memberFindMany,
  withWorkspaceAdminGuard,
} = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  withRateLimit: vi.fn(),
  workspaceTransaction: vi.fn(),
  memberFindMany: vi.fn(),
  withWorkspaceAdminGuard: vi.fn(),
}));

vi.mock("@/utils/auth", () => ({ getSessionFromRequest }));
vi.mock("@/lib/api/rate-limit", () => ({
  withRateLimit,
  defaultRateLimits: { strict: { limit: 30, window: 60, strictFallback: true } },
}));
vi.mock("@/prisma/client", () => ({
  prisma: {
    $transaction: workspaceTransaction,
    workspaceMember: { findMany: memberFindMany },
  },
}));
vi.mock("@/lib/sourcing/auth", () => ({
  ensureWorkspaceAdminRetention: vi.fn(),
  requireWorkspaceRole: vi.fn(),
  SourcingAccessError: class SourcingAccessError extends Error {},
  withWorkspaceAdminGuard,
  workspaceRoles: ["admin", "member"],
}));

import { POST as createWorkspace } from "./route";
import { POST as updateMember } from "./[id]/members/route";

const user = { id: "user-1", role: "admin" };

beforeEach(() => {
  getSessionFromRequest.mockReset();
  withRateLimit.mockReset();
  workspaceTransaction.mockReset();
  memberFindMany.mockReset();
  withWorkspaceAdminGuard.mockReset();
  getSessionFromRequest.mockResolvedValue(user);
  withRateLimit.mockResolvedValue(
    NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
  );
});

describe("workspace mutation rate limits", () => {
  it("returns the workspace creation limiter response before invoking the transaction", async () => {
    const response = await createWorkspace(
      new NextRequest("http://localhost/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: "Operations" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(withRateLimit).toHaveBeenCalledOnce();
    expect(withRateLimit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ strictFallback: true }),
      "workspaces:create:user-1",
    );
    expect(workspaceTransaction).not.toHaveBeenCalled();
  });

  it("returns the member update limiter response before invoking workspace handlers", async () => {
    const response = await updateMember(
      new NextRequest("http://localhost/api/workspaces/workspace-1/members", {
        method: "POST",
        body: JSON.stringify({ userId: "user-2", role: "member" }),
      }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );

    expect(response.status).toBe(429);
    expect(withRateLimit).toHaveBeenCalledOnce();
    expect(withRateLimit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ strictFallback: true }),
      "workspaces:members:update:user-1",
    );
    expect(withWorkspaceAdminGuard).not.toHaveBeenCalled();
  });
});
