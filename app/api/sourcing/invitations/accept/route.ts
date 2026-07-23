import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { acceptWorkspaceInvitation } from "@/lib/sourcing/invitations";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateAllServerCaches } from "@/lib/cache";

const schema = z.object({ token: z.string().min(32), name: z.string().trim().min(1).max(120), password: z.string().min(8).max(128), confirmPassword: z.string() }).refine((value) => value.password === value.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
export async function POST(request: NextRequest) { try { const limited = await withRateLimit(request, defaultRateLimits.auth); if (limited) return limited; const body = schema.parse(await request.json()); await acceptWorkspaceInvitation(body.token, body.name, body.password); void invalidateAllServerCaches(); return NextResponse.json({ status: "accepted" }, { status: 201 }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to accept invitation" }, { status: error instanceof z.ZodError ? 400 : 409 }); } }
