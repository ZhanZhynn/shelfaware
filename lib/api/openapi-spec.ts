/**
 * OpenAPI 3.0 specification for ShelfAware API
 * Single source of truth for API documentation; consumed by GET /api/openapi and API docs page.
 */

export interface OpenApiSpecOptions {
  baseUrl: string;
}

/**
 * Build OpenAPI 3.0 spec object for the ShelfAware inventory API
 */
export function getOpenApiSpec(options: OpenApiSpecOptions): Record<string, unknown> {
  const { baseUrl } = options;
  // OpenAPI only permits non-empty security requirement arrays for OAuth/OpenID.
  // API-token scopes are documented with x-requiredApiTokenScopes instead.
  const marketplaceReadSecurity = [{ bearerAuth: [] }, { sessionCookie: [] }];
  const marketplaceLiveSecurity = [{ bearerAuth: [] }, { sessionCookie: [] }];
  const marketplaceSyncSecurity = [{ bearerAuth: [] }, { sessionCookie: [] }];
  const marketplaceFinanceSecurity = [{ bearerAuth: [] }, { sessionCookie: [] }];
  const platformParameter = {
    name: "platform",
    in: "path",
    required: true,
    schema: { type: "string", enum: ["shopee", "lazada", "tiktok", "shopify"] },
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "ShelfAware Inventory API",
      description: "API for the ShelfAware inventory management system. Standard endpoints use the session cookie. Marketplace v1 endpoints also accept scoped bearer tokens created in Admin > API Tokens.",
      version: "1.0.0",
    },
    servers: [{ url: baseUrl }],
    security: [{ sessionCookie: [] }],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "session_id",
          description: "Session cookie set after login. Send credentials: 'include' with same-origin requests.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "swa_<token>",
          description: "Scoped API token. Send `Authorization: Bearer swa_...`. Marketplace v1 operations require the scope shown for each operation.",
        },
      },
      schemas: {
        ApiToken: {
          type: "object",
          required: ["id", "name", "prefix", "scopes", "createdAt"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            prefix: { type: "string", example: "swa_abcdefghijk" },
            scopes: { type: "array", items: { type: "string", enum: ["marketplace:read", "marketplace:live", "marketplace:sync", "marketplace:finance", "marketplace:pii"] } },
            createdAt: { type: "string", format: "date-time" },
            expiresAt: { type: "string", format: "date-time", nullable: true },
            lastUsedAt: { type: "string", format: "date-time", nullable: true },
            revokedAt: { type: "string", format: "date-time", nullable: true },
          },
        },
        MarketplaceError: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "requestId"],
              properties: {
                code: { type: "string", example: "UNAUTHORIZED" },
                message: { type: "string" },
                requestId: { type: "string" },
              },
            },
          },
        },
      },
    },
    paths: {
      "/api/auth/register": {
        post: {
          summary: "Register a new user",
          tags: ["Authentication"],
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "email", "password"],
                  properties: {
                    name: { type: "string" },
                    email: { type: "string", format: "email" },
                    password: { type: "string", minLength: 6 },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "User created" },
            "400": { description: "Bad request" },
          },
        },
      },
      "/api/auth/login": {
        post: {
          summary: "Authenticate and get session",
          tags: ["Authentication"],
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Session cookie set" },
            "401": { description: "Invalid credentials" },
          },
        },
      },
      "/api/auth/logout": {
        post: {
          summary: "Logout and clear session",
          tags: ["Authentication"],
          responses: { "200": { description: "Logged out" } },
        },
      },
      "/api/auth/session": {
        get: {
          summary: "Get current user session",
          tags: ["Authentication"],
          responses: {
            "200": { description: "User session" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/api-tokens": {
        get: {
          summary: "List API tokens for the current user",
          tags: ["API Tokens"],
          responses: {
            "200": {
              description: "Token metadata; token secrets are never returned",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      tokens: { type: "array", items: { $ref: "#/components/schemas/ApiToken" } },
                    },
                  },
                },
              },
            },
            "401": { description: "Unauthorized" },
          },
        },
        post: {
          summary: "Create an API token",
          description: "Requires a session cookie. Save the returned `token` immediately; it cannot be retrieved again.",
          tags: ["API Tokens"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "scopes"],
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 100 },
                    scopes: { type: "array", minItems: 1, items: { type: "string", enum: ["marketplace:read", "marketplace:live", "marketplace:sync", "marketplace:finance", "marketplace:pii"] } },
                    expiresAt: { type: "string", format: "date-time", description: "Optional future ISO-8601 timestamp" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Token created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      token: { type: "string", description: "Shown only in this response" },
                      apiToken: { $ref: "#/components/schemas/ApiToken" },
                    },
                  },
                },
              },
            },
            "401": { description: "Unauthorized" },
            "422": { description: "Invalid token request" },
          },
        },
      },
      "/api/api-tokens/{id}": {
        delete: {
          summary: "Revoke an API token",
          tags: ["API Tokens"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Token revoked" }, "401": { description: "Unauthorized" }, "404": { description: "Token not found" } },
        },
      },
      "/api/products": {
        get: {
          summary: "List products",
          tags: ["Products"],
          responses: { "200": { description: "List of products" } },
        },
        post: {
          summary: "Create product",
          tags: ["Products"],
          requestBody: { content: { "application/json": { schema: { type: "object" } } } },
          responses: { "201": { description: "Product created" } },
        },
      },
      "/api/products/{id}": {
        get: { summary: "Get product by ID", tags: ["Products"], responses: { "200": { description: "Product" } } },
        put: { summary: "Update product", tags: ["Products"], responses: { "200": { description: "Updated" } } },
        delete: { summary: "Delete product", tags: ["Products"], responses: { "200": { description: "Deleted" } } },
      },
      "/api/categories": {
        get: { summary: "List categories", tags: ["Categories"], responses: { "200": { description: "List of categories" } } },
        post: { summary: "Create category", tags: ["Categories"], responses: { "201": { description: "Category created" } } },
      },
      "/api/categories/{id}": {
        put: { summary: "Update category", tags: ["Categories"], responses: { "200": { description: "Updated" } } },
        delete: { summary: "Delete category", tags: ["Categories"], responses: { "200": { description: "Deleted" } } },
      },
      "/api/suppliers": {
        get: { summary: "List suppliers", tags: ["Suppliers"], responses: { "200": { description: "List of suppliers" } } },
        post: { summary: "Create supplier", tags: ["Suppliers"], responses: { "201": { description: "Supplier created" } } },
      },
      "/api/suppliers/{id}": {
        put: { summary: "Update supplier", tags: ["Suppliers"], responses: { "200": { description: "Updated" } } },
        delete: { summary: "Delete supplier", tags: ["Suppliers"], responses: { "200": { description: "Deleted" } } },
      },
      "/api/orders": {
        get: { summary: "List orders", tags: ["Orders"], responses: { "200": { description: "List of orders" } } },
        post: { summary: "Create order", tags: ["Orders"], responses: { "201": { description: "Order created" } } },
      },
      "/api/orders/{id}": {
        get: { summary: "Get order by ID", tags: ["Orders"], responses: { "200": { description: "Order" } } },
        put: { summary: "Update order", tags: ["Orders"], responses: { "200": { description: "Updated" } } },
        delete: { summary: "Cancel order", tags: ["Orders"], responses: { "200": { description: "Cancelled" } } },
      },
      "/api/invoices": {
        get: { summary: "List invoices", tags: ["Invoices"], responses: { "200": { description: "List of invoices" } } },
        post: { summary: "Create invoice", tags: ["Invoices"], responses: { "201": { description: "Invoice created" } } },
      },
      "/api/invoices/{id}": {
        get: { summary: "Get invoice by ID", tags: ["Invoices"], responses: { "200": { description: "Invoice" } } },
        put: { summary: "Update invoice", tags: ["Invoices"], responses: { "200": { description: "Updated" } } },
        delete: { summary: "Delete invoice", tags: ["Invoices"], responses: { "200": { description: "Deleted" } } },
      },
      "/api/health": {
        get: {
          summary: "Health check",
          tags: ["System"],
          security: [],
          responses: { "200": { description: "Database, Redis, ImageKit, Brevo status and uptime" } },
        },
      },
      "/api/v1/marketplaces/shops": {
        get: {
          summary: "List accessible marketplace shops",
          description: "Use the returned internal shop ID to scope other marketplace v1 requests.",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [{ name: "platform", in: "query", schema: { type: "string", enum: ["shopee", "lazada", "tiktok", "shopify"] } }],
          responses: { "200": { description: "Accessible shops" }, "401": { description: "Unauthenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/MarketplaceError" } } } }, "403": { description: "Token lacks marketplace:read" } },
        },
      },
      "/api/v1/marketplaces/{platform}/products": {
        get: {
          summary: "List locally synchronized marketplace products",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [platformParameter, { name: "shopId", in: "query", schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "search", in: "query", schema: { type: "string", maxLength: 200 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, { name: "cursor", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Paginated local product catalog" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read" }, "422": { description: "Invalid query" } },
        },
      },
      "/api/v1/marketplaces/{platform}/orders": {
        get: {
          summary: "List locally synchronized marketplace orders",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [platformParameter, { name: "shopId", in: "query", schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "createdAfter", in: "query", schema: { type: "string", format: "date-time" } }, { name: "createdBefore", in: "query", schema: { type: "string", format: "date-time" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, { name: "cursor", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Paginated local order catalog" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read" }, "422": { description: "Invalid query" } },
        },
      },
      "/api/v1/marketplaces/{platform}/products/{id}": {
        get: {
          summary: "Get a locally synchronized marketplace product",
          description: "Reads the persisted catalog only; it never calls a marketplace provider.",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [platformParameter, { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }],
          responses: { "200": { description: "Local product" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read" }, "404": { description: "Product not found" } },
        },
      },
      "/api/v1/marketplaces/{platform}/orders/{id}": {
        get: {
          summary: "Get a locally synchronized marketplace order",
          description: "Reads the persisted catalog only; it never calls a marketplace provider.",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [platformParameter, { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }],
          responses: { "200": { description: "Local order" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read" }, "404": { description: "Order not found" } },
        },
      },
      "/api/v1/marketplaces/{platform}/live/products": {
        get: {
          summary: "Read products directly from a marketplace provider",
          description: "Live reads require a shop ID and do not start a sync or write marketplace data.",
          tags: ["Marketplace v1"],
          security: marketplaceLiveSecurity,
          "x-requiredApiTokenScopes": ["marketplace:live"],
          parameters: [platformParameter, { name: "shopId", in: "query", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 50 } }, { name: "cursor", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Paginated live provider products" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:live" }, "502": { description: "Live provider unavailable" } },
        },
      },
      "/api/v1/marketplaces/{platform}/live/orders": {
        get: {
          summary: "Read orders directly from a marketplace provider",
          description: "Live reads require a shop ID. Omitted date bounds default to the most recent seven days; the maximum range is 31 days.",
          tags: ["Marketplace v1"],
          security: marketplaceLiveSecurity,
          "x-requiredApiTokenScopes": ["marketplace:live"],
          parameters: [platformParameter, { name: "shopId", in: "query", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "createdAfter", in: "query", schema: { type: "string", format: "date-time" } }, { name: "createdBefore", in: "query", schema: { type: "string", format: "date-time" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 50 } }, { name: "cursor", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Paginated live provider orders" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:live" }, "502": { description: "Live provider unavailable" } },
        },
      },
      "/api/v1/marketplaces/{platform}/syncs": {
        post: {
          summary: "Queue a marketplace synchronization job",
          description: "Creates durable work only; it never invokes a marketplace provider in the request. Supply an optional Idempotency-Key header to coalesce duplicate requests.",
          tags: ["Marketplace v1"],
          security: marketplaceSyncSecurity,
          "x-requiredApiTokenScopes": ["marketplace:sync"],
          parameters: [platformParameter, { name: "Idempotency-Key", in: "header", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["shopId", "syncType"],
                  additionalProperties: false,
                  properties: {
                    shopId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
                    syncType: { type: "string", enum: ["products", "orders", "finance", "returns", "ads", "payouts", "all"] },
                    input: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: { "202": { description: "Sync job queued or coalesced" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:sync" }, "404": { description: "Shop not found" }, "422": { description: "Invalid body or idempotency key" } },
        },
      },
      "/api/v1/marketplaces/{platform}/syncs/{id}": {
        get: {
          summary: "Get a marketplace synchronization job",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [platformParameter, { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }],
          responses: { "200": { description: "Sync job" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read" }, "404": { description: "Sync job not found" } },
        },
      },
      "/api/v1/marketplaces/{platform}/analytics/{metric}": {
        get: {
          summary: "Get marketplace analytics",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [platformParameter, { name: "metric", in: "path", required: true, schema: { type: "string", enum: ["summary", "revenue-trend", "products", "buyers", "clv", "profit"] } }, { name: "shopId", in: "query", schema: { type: "string" } }, { name: "dateFrom", in: "query", schema: { type: "string", format: "date", description: "YYYY-MM-DD" } }, { name: "dateTo", in: "query", schema: { type: "string", format: "date", description: "YYYY-MM-DD" } }, { name: "currency", in: "query", schema: { type: "string", default: "native" } }, { name: "granularity", in: "query", schema: { type: "string", enum: ["day", "week", "month"], default: "day" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, { name: "cursor", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Analytics metric" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read or shop access" }, "409": { description: "Currency conversion or aggregation conflict" }, "422": { description: "Invalid query" } },
        },
      },
      "/api/v1/marketplaces/{platform}/financial-records": {
        get: {
          summary: "List local marketplace financial records",
          tags: ["Marketplace v1"],
          security: marketplaceFinanceSecurity,
          "x-requiredApiTokenScopes": ["marketplace:finance"],
          parameters: [platformParameter, { name: "shopId", in: "query", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }, { name: "cursor", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Paginated financial records" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:finance" }, "404": { description: "Shop not found" }, "422": { description: "Invalid query" } },
        },
      },
      "/api/v1/marketplaces/{platform}/reconciliation-status": {
        get: {
          summary: "Get a marketplace shop reconciliation status",
          tags: ["Marketplace v1"],
          security: marketplaceFinanceSecurity,
          "x-requiredApiTokenScopes": ["marketplace:finance"],
          parameters: [platformParameter, { name: "shopId", in: "query", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }],
          responses: { "200": { description: "Reconciliation status" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:finance" }, "404": { description: "Shop not found" }, "422": { description: "Invalid query" } },
        },
      },
      "/api/v1/marketplaces/{platform}/profit": {
        get: {
          summary: "Get local marketplace profit detail",
          tags: ["Marketplace v1"],
          security: marketplaceFinanceSecurity,
          "x-requiredApiTokenScopes": ["marketplace:finance"],
          parameters: [platformParameter, { name: "shopId", in: "query", schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, { name: "dateFrom", in: "query", schema: { type: "string", format: "date", description: "YYYY-MM-DD" } }, { name: "dateTo", in: "query", schema: { type: "string", format: "date", description: "YYYY-MM-DD" } }],
          responses: { "200": { description: "Profit detail" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:finance" }, "404": { description: "Shop not found" }, "422": { description: "Invalid query" } },
        },
      },
    },
  };
}
