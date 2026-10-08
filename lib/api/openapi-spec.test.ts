import { describe, expect, it } from "vitest";
import { getOpenApiSpec } from "./openapi-spec";

describe("getOpenApiSpec", () => {
  it("documents scoped bearer authentication and every marketplace v1 route", () => {
    const spec = getOpenApiSpec({ baseUrl: "https://console.example.test" }) as any;

    expect(spec.servers).toEqual([{ url: "https://console.example.test" }]);
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
      bearerFormat: "swa_<token>",
    });
    expect(spec.paths).toMatchObject({
      "/api/v1/marketplaces/shops": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:read"] } },
      "/api/v1/marketplaces/{platform}/products": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:read"] } },
      "/api/v1/marketplaces/{platform}/orders": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:read"] } },
      "/api/v1/marketplaces/{platform}/products/{id}": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:read"] } },
      "/api/v1/marketplaces/{platform}/orders/{id}": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:read"] } },
      "/api/v1/marketplaces/{platform}/live/products": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:live"] } },
      "/api/v1/marketplaces/{platform}/live/orders": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:live"] } },
      "/api/v1/marketplaces/{platform}/syncs": { post: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:sync"] } },
      "/api/v1/marketplaces/{platform}/syncs/{id}": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:read"] } },
      "/api/v1/marketplaces/{platform}/analytics/{metric}": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:read"] } },
      "/api/v1/marketplaces/{platform}/financial-records": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:finance"] } },
      "/api/v1/marketplaces/{platform}/reconciliation-status": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:finance"] } },
      "/api/v1/marketplaces/{platform}/profit": { get: { security: [{ bearerAuth: [] }, { sessionCookie: [] }], "x-requiredApiTokenScopes": ["marketplace:finance"] } },
    });
  });

  it("documents session-authenticated token lifecycle endpoints", () => {
    const spec = getOpenApiSpec({ baseUrl: "http://localhost:3000" }) as any;

    expect(spec.paths["/api/api-tokens"].post.responses["201"].description).toBe("Token created");
    expect(spec.paths["/api/api-tokens/{id}"].delete.summary).toBe("Revoke an API token");
  });
});
