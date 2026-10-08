import type { User } from "@prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import {
  ApiTokenAuthenticationError,
  type ApiTokenScope,
  parseBearerToken,
  resolveApiToken,
} from "./api-token";

export type ApiActor = {
  user: User;
  authType: "session" | "api_token";
  tokenId?: string;
};

export class ApiScopeError extends Error {}

export async function requireApiActor(
  request: Parameters<typeof getSessionFromRequest>[0] & { headers: Headers },
  requiredScopes: ApiTokenScope[] = [],
): Promise<ApiActor> {
  const bearer = parseBearerToken(request.headers.get("authorization"));
  if (bearer) {
    const resolved = await resolveApiToken(bearer);
    if (!requiredScopes.every((scope) => resolved.token.scopes.includes(scope))) {
      throw new ApiScopeError("Token is missing a required scope");
    }
    return { user: resolved.user, authType: "api_token", tokenId: resolved.token.id };
  }

  const user = await getSessionFromRequest(request);
  if (!user) throw new ApiTokenAuthenticationError("Unauthorized");
  return { user, authType: "session" };
}
