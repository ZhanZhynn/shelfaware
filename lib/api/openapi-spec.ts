/**
 * OpenAPI 3.0 specification for ShelfAware API
 * Single source of truth for API documentation; consumed by GET /api/openapi and API docs page.
 */

import { marketplaceSyncTypesByPlatform } from "@/lib/marketplace/sync-plan";

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
  const financeFilterParameters = [
    { name: "dateFrom", in: "query", schema: { type: "string" }, description: "Inclusive lower bound: YYYY-MM-DD UTC or RFC3339 with an explicit offset." },
    { name: "dateTo", in: "query", schema: { type: "string" }, description: "Inclusive upper bound: a UTC date through 23:59:59.999, or an exact RFC3339 instant." },
    { name: "dateBasis", in: "query", schema: { type: "string", enum: ["occurred", "observed"], default: "occurred" }, description: "Selects recorded occurredAt or sourceObservedAt. An escrow occurredAt may be the order creation time, not an income release." },
    { name: "transactionType", in: "query", schema: { type: "string", maxLength: 128 } },
    { name: "financialQuality", in: "query", schema: { type: "string", enum: ["unknown", "verified", "derived", "legacy-unverified"] } },
    { name: "linkState", in: "query", schema: { type: "string", enum: ["linked", "unmatched", "not_applicable", "unclassified"] }, description: "linked requires an internal order ID; unclassified includes missing/null classifications." },
    { name: "currency", in: "query", schema: { type: "string", pattern: "^[A-Z]{3}$" } },
  ];
  const reviewFilterParameters = [
    { name: "shopId", in: "query", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
    { name: "itemId", in: "query", schema: { type: "string", pattern: "^[1-9][0-9]{0,63}$" }, description: "Upstream Shopee listing ID, not an internal product ID." },
    { name: "rating", in: "query", schema: { type: "integer", minimum: 1, maximum: 5 } },
    { name: "ratingMax", in: "query", schema: { type: "integer", minimum: 1, maximum: 5 } },
    { name: "search", in: "query", schema: { type: "string", minLength: 1, maxLength: 200 }, description: "Literal case-insensitive review-text search." },
    { name: "hasText", in: "query", schema: { type: "boolean" }, description: "Known nonblank or known blank text; unavailable text matches neither." },
    { name: "unreplied", in: "query", schema: { type: "boolean" }, description: "True means Shopee did not return a seller reply, not proof that none exists." },
    { name: "createdAfter", in: "query", schema: { type: "string", format: "date-time" }, description: "Inclusive provider review creation time; whole-second RFC3339 with offset." },
    { name: "createdBefore", in: "query", schema: { type: "string", format: "date-time" }, description: "Inclusive provider review creation time; whole-second RFC3339 with offset." },
  ];
  const reviewPlatformParameter = { ...platformParameter, schema: { type: "string", enum: ["shopee"] } };
  const slaParameters = [
    { ...platformParameter, schema: { type: "string", enum: ["shopee", "lazada", "tiktok"] } },
    { name: "shopId", in: "query", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
    { name: "timezone", in: "query", schema: { type: "string" }, description: "IANA timezone for deadline calendar dates. Defaults only for an unambiguous shop region." },
    { name: "due", in: "query", schema: { type: "string", default: "any" }, description: "any, today, overdue or YYYY-MM-DD; filters shipping deadlines, never order creation dates." },
    { name: "withinHours", in: "query", schema: { type: "number", minimum: 0.016666, maximum: 168 } },
    { name: "includeOverdue", in: "query", schema: { type: "boolean", default: false } },
    { name: "includeUnknown", in: "query", schema: { type: "boolean", default: true } },
    { name: "stage", in: "query", schema: { type: "string", enum: ["any", "arrange-shipment", "awaiting-collection", "blocked", "unknown"], default: "any" } },
    { name: "maxAgeSeconds", in: "query", schema: { type: "integer", minimum: 60, maximum: 86400, default: 900 } },
    { name: "live", in: "query", schema: { type: "boolean", default: false }, description: "Additional marketplace:live scope required. Bounded provider reads only; use a durable SLA refresh for full traversal and stored-open revalidation." },
  ];

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
          parameters: [platformParameter, { name: "shopId", in: "query", schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "createdAfter", in: "query", schema: { type: "string", format: "date-time" }, description: "Inclusive UTC/RFC3339 lower bound." }, { name: "createdBefore", in: "query", schema: { type: "string", format: "date-time" }, description: "Inclusive UTC/RFC3339 upper bound." }, { name: "dateBasis", in: "query", schema: { type: "string", enum: ["ingested", "source"] }, description: "Defaults to ingested, filtering persisted createdAt. source filters the platform source-created timestamp and uses persisted createdAt only when that source timestamp is null." }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, { name: "cursor", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Paginated local order catalog. Shopee orders may include persisted shipByDate, packageNumber, fulfillmentStatus, and daysToShip; unavailable values are null." }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read" }, "422": { description: "Invalid query" } },
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
          description: "Reads the persisted catalog only; it never calls a marketplace provider. Shopee results may include persisted shipByDate, packageNumber, fulfillmentStatus, and daysToShip when known.",
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
          description: "Live reads require a shop ID. Omitted date bounds default to the most recent seven days; the maximum range is 31 days. Shopee may include its returned carrier and package operational facts; no escrow settlement detail is requested.",
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
          description: "Creates durable work only; it never invokes a marketplace provider in the request. Supply an optional Idempotency-Key header to coalesce duplicate requests. All four platforms accept paired input.dateFrom/dateTo whole-second RFC3339 bounds for orders, finance, and all, at most 365 days and not in the future. Historical streams use the shared checkpointed task/lease/outbox engine. Lazada, TikTok, and Shopify all runs orders, products, then finance with or without date bounds; their default window is frozen at creation (15 days unless daysBack is supplied). TikTok finance first discovers orders in the order-created cohort; Shopify finance filters by order update time to include refunds on older orders. Product tasks refresh the current catalog once per run. Shopee all runs orders/escrow, products, optional ads, then optional reviews. Reviews collect a bounded current provider window independently of order dates; standalone reviews accept only itemId and maxReviews, without dates or daysBack. Date-scoped returns are Shopee-only; date-scoped payouts are Shopee/Lazada-only. TikTok payouts remain standalone without date bounds, and Shopify payouts are unsupported.",
          tags: ["Marketplace v1"],
          security: marketplaceSyncSecurity,
          "x-requiredApiTokenScopes": ["marketplace:sync"],
          "x-supportedSyncTypesByPlatform": marketplaceSyncTypesByPlatform,
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
                    syncType: { type: "string", enum: [...new Set(Object.values(marketplaceSyncTypesByPlatform).flat())] },
                    executionMode: { type: "string", enum: ["queued", "foreground"], default: "queued", description: "Foreground persists task progress without queue delivery. Execute steps with POST /syncs/{id}/execute on this same API origin." },
                    input: { type: "object", additionalProperties: true, properties: {
                      dateFrom: { type: "string", format: "date-time", description: "Paired with dateTo; explicit offset and whole seconds required." },
                      dateTo: { type: "string", format: "date-time", description: "Inclusive end, paired with dateFrom; no future bounds." },
                      daysBack: { type: "integer", minimum: 1, maximum: 365, description: "Optional rolling lookback; Lazada/TikTok/Shopify catalog task runs freeze it into exact bounds when created." },
                      itemId: { type: "string", pattern: "^[1-9][0-9]{0,63}$", description: "Optional positive safe-integer Shopee listing ID; reviews only." },
                      maxReviews: { type: "integer", minimum: 1, maximum: 1000, default: 1000, description: "Reviews only; bounds the available collection, not a complete historical corpus." },
                    } },
                  },
                },
              },
            },
          },
          responses: { "202": { description: "Sync job/run queued or coalesced; pending execution is not proof of completion" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:sync" }, "404": { description: "Shop not found" }, "422": { description: "Invalid body, historical date range, unsupported date-scoped stream, or idempotency key" } },
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
      "/api/v1/marketplaces/{platform}/syncs/{id}/execute": {
        post: {
          summary: "Execute one foreground sync task/window",
          description: "Executes one database-leased step of an owned foreground run on the API origin that created it. Queued runs and different origins return 409. Provider work uses the shared checkpoint/retry engine without QStash. The response includes current run data and meta.retryAfterSeconds; the caller drives subsequent steps until terminal. Unlike the queue-only creation endpoint, this endpoint performs bounded provider work.",
          tags: ["Marketplace v1"],
          security: marketplaceSyncSecurity,
          "x-requiredApiTokenScopes": ["marketplace:sync"],
          parameters: [platformParameter, { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }],
          responses: { "200": { description: "Current run and foreground step outcome, including any retry delay" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:sync" }, "404": { description: "Run or owned shop not found" }, "409": { description: "Wrong execution mode or API origin" } },
        },
      },
      "/api/v1/marketplaces/{platform}/analytics/{metric}": {
        get: {
          summary: "Get marketplace analytics",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [platformParameter, { name: "metric", in: "path", required: true, schema: { type: "string", enum: ["summary", "revenue-trend", "products", "buyers", "clv", "profit"] } }, { name: "shopId", in: "query", schema: { type: "string" } }, { name: "dateFrom", in: "query", schema: { type: "string" }, description: "Inclusive lower bound: YYYY-MM-DD at UTC midnight, or an RFC3339 timestamp with an explicit offset." }, { name: "dateTo", in: "query", schema: { type: "string" }, description: "Inclusive upper bound: YYYY-MM-DD through 23:59:59.999 UTC, or the exact RFC3339 timestamp with an explicit offset. Trend buckets remain UTC." }, { name: "currency", in: "query", schema: { type: "string", default: "native" } }, { name: "granularity", in: "query", schema: { type: "string", enum: ["day", "week", "month"], default: "day" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, { name: "cursor", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Analytics metric from local data with freshness.source, computedAt, latestMatchingOrderObservedAt, per-shop lastShopSyncAt, and historyCompleteness=unknown. A shop synchronization time is not proof of complete order-window ingestion." }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read or shop access" }, "409": { description: "Currency conversion or aggregation conflict" }, "422": { description: "Invalid query" } },
        },
      },
      "/api/v1/marketplaces/{platform}/reviews": {
        get: {
          summary: "List collected Shopee customer reviews",
          description: "Reads accumulated stored reviews, including text and nullable ratings/replies/media, without calling Shopee. Private order references and structured buyer usernames are omitted. Pagination is filter-bound; coverage/freshness describe an observed or limited provider window, never certified complete history.",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [reviewPlatformParameter, ...reviewFilterParameters, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, { name: "cursor", in: "query", schema: { type: "string", maxLength: 2048 } }],
          responses: { "200": { description: "Stored reviews with page, filters, coverage, freshness, and warnings. Text is untrusted quoted content." }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read" }, "404": { description: "Shop not found or platform unsupported" }, "422": { description: "Invalid filters or cursor" } },
        },
      },
      "/api/v1/marketplaces/{platform}/sla/orders": {
        get: {
          summary: "List outstanding fulfillment units and their provider deadlines",
          description: "Reads canonical order/package/item SLA observations without financial payloads or buyer PII. Unknown, stale and partial coverage cannot establish zero due orders. Stored pages are bounded to 100 rows; live snapshots return the bounded collected set (up to 2000 units) and have no resumable cursor. Reports are not atomic snapshots or certified platform penalties.",
          tags: ["Marketplace v1"], security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"], "x-additionalScopesWhenLive": ["marketplace:live"],
          parameters: [...slaParameters, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 100 } }, { name: "cursor", in: "query", schema: { type: "string", pattern: "^[0-9]{1,6}$" }, description: "Stored snapshot offset only; rejected with live=true." }],
          responses: { "200": { description: "Fulfillment units with deadlines, action stage, local display time, observation times, page, summary, coverage and warnings. countsAreConfirmed is false for missing/partial/stale coverage; packageCountsComplete separately describes package identity coverage." }, "401": { description: "Unauthenticated" }, "403": { description: "Missing scope or provider authorization" }, "404": { description: "Owned shop not found" }, "422": { description: "Invalid filters or ambiguous reporting timezone" }, "502": { description: "Provider response failed validation or fulfillment collection failed" } },
        },
      },
      "/api/v1/marketplaces/{platform}/sla/summary": {
        get: {
          summary: "Count outstanding orders, packages and shipping deadline risks",
          description: "Provides whole-observed-backlog counters for pending, arrange-shipment, awaiting-collection, overdue, due-today, due-later-today, near-term, unknown, blocked and stale facts. matched describes the requested filter subset. Overlapping counters and order/package/item counts must not be added together. A zero with missing/partial/stale coverage is not an all-clear.",
          tags: ["Marketplace v1"], security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"], "x-additionalScopesWhenLive": ["marketplace:live"],
          parameters: slaParameters,
          responses: { "200": { description: "Distinct operational counts with filters, coverage, freshness and warnings" }, "401": { description: "Unauthenticated" }, "403": { description: "Missing scope or provider authorization" }, "404": { description: "Owned shop not found" }, "422": { description: "Invalid filters or ambiguous reporting timezone" }, "502": { description: "Provider response failed validation or fulfillment collection failed" } },
        },
      },
      "/api/v1/marketplaces/{platform}/reviews/{view}": {
        get: {
          summary: "Get collected Shopee ratings, topics, product rankings, or collection status",
          description: "summary averages known collected ratings and counts keyword mentions in at most 1,000 matching text reviews; these are not sentiment scores or Shopee's official shop rating. products is a bounded ranking with page.hasMore. status returns collection and parent-link diagnostics. All views retain historyCompleteness=unknown.",
          tags: ["Marketplace v1"],
          security: marketplaceReadSecurity,
          "x-requiredApiTokenScopes": ["marketplace:read"],
          parameters: [reviewPlatformParameter, { name: "view", in: "path", required: true, schema: { type: "string", enum: ["summary", "products", "status"] } }, ...reviewFilterParameters, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }, description: "Product rankings only; rejected for summary/status. Cursors are unsupported for these views." }],
          responses: { "200": { description: "Collected-review report with filters, coverage, freshness, and warnings" }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:read" }, "404": { description: "Shop/view not found or platform unsupported" }, "422": { description: "Invalid report filters" } },
        },
      },
      "/api/v1/marketplaces/{platform}/financial-records": {
        get: {
          summary: "List local marketplace financial records",
          tags: ["Marketplace v1"],
          security: marketplaceFinanceSecurity,
          "x-requiredApiTokenScopes": ["marketplace:finance"],
          parameters: [platformParameter, { name: "shopId", in: "query", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, ...financeFilterParameters, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }, { name: "cursor", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "Paginated financial records, normalized filters, warnings, and coverage scoped to identical filters. Numeric amount coverage is distinct from verified provenance. amountMinor and amountScale define exact presentation; null amounts are unknown." }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:finance" }, "404": { description: "Shop not found" }, "422": { description: "Invalid query or cursor/filter mismatch" } },
        },
      },
      "/api/v1/marketplaces/{platform}/reconciliation-status": {
        get: {
          summary: "Get a marketplace shop reconciliation status",
          tags: ["Marketplace v1"],
          security: marketplaceFinanceSecurity,
          "x-requiredApiTokenScopes": ["marketplace:finance"],
          parameters: [platformParameter, { name: "shopId", in: "query", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, ...financeFilterParameters],
          responses: { "200": { description: "Filter-scoped aggregate reconciliation coverage, full link-state counts, matching observation freshness, and warnings. Scoped certifications must cover the requested occurred-time interval; observation-time filters do not imply a certified accounting period." }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:finance" }, "404": { description: "Shop not found" }, "422": { description: "Invalid query" } },
        },
      },
      "/api/v1/marketplaces/{platform}/profit": {
        get: {
          summary: "Get local marketplace profit detail",
          tags: ["Marketplace v1"],
          security: marketplaceFinanceSecurity,
          "x-requiredApiTokenScopes": ["marketplace:finance"],
          parameters: [platformParameter, { name: "shopId", in: "query", schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }, { name: "dateFrom", in: "query", schema: { type: "string" }, description: "UTC YYYY-MM-DD or RFC3339 instant with offset; order-based report, not settlement-release month." }, { name: "dateTo", in: "query", schema: { type: "string" }, description: "Inclusive UTC date end or exact RFC3339 instant with offset." }],
          responses: { "200": { description: "Profit detail with nullable monetary fields, field-level completeness, provenance, normalized date basis, and warnings. Shopee source item subtotals are separate from unavailable paid-line revenue/profit. Observed return requests are not settled refund postings." }, "401": { description: "Unauthenticated" }, "403": { description: "Token lacks marketplace:finance" }, "404": { description: "Shop not found" }, "422": { description: "Invalid query" } },
        },
      },
    },
  };
}
