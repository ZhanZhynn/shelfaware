import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { hasSourcingAccess, sourcingDestination } from "@/lib/sourcing/portal";
export async function GET(request: NextRequest) { const user = await getSessionFromRequest(request); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const allowed = await hasSourcingAccess(user); return NextResponse.json({ allowed, destination: allowed ? sourcingDestination(user) : null }); }
