# Agent Context: ShelfAware

> Quick-reference for AI agents working in this codebase. For full details, see `README.md` and `docs/PROJECT_WALKTHROUGH.md`.

---

## What This Is

**ShelfAware** is a full-stack stock/warehouse inventory management platform with deep **Shopee** and **Lazada** marketplace integrations. It syncs products, orders, returns, and ads performance from both marketplaces into a unified admin dashboard. Three user roles: **Admin** (full access), **Supplier** (own products/orders), **Client** (browse/order/pay).

**Live:** `https://console.shelfaware.my`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, TypeScript 5, Tailwind CSS 3.4, shadcn/ui (Radix) |
| State | TanStack Query 5 (server), Zustand 5 (client) |
| Forms | React Hook Form + Zod validation |
| Charts | Recharts 3 |
| Database | MongoDB via Prisma ORM 6.4 |
| Auth | JWT (cookie-based `session_id`), Google OAuth (next-auth 5) |
| Payments | Stripe |
| Shipping | Shippo |
| Email | Brevo |
| Images | ImageKit |
| Cache | Upstash Redis (optional) |
| Background Jobs | Upstash QStash (optional) |
| Monitoring | Sentry |
| AI | OpenCode Zen (primary), Groq Llama 3.3 70B (fallback) |
| Marketplace SDKs | `@congminh1254/shopee-sdk`, `lazada-api-client` |
| Testing | Vitest |
| Deployment | Vercel or Docker + Cloudflare Tunnel |

---

## Quick Start

```bash
npm install
npx prisma generate
cp .env.example .env   # fill in required vars
npm run dev
```

**Required environment variables:**
- `DATABASE_URL` — MongoDB connection string
- `JWT_SECRET` — JWT signing secret
- `NEXT_PUBLIC_API_URL` — Base URL (e.g. `http://localhost:3000`)

**Optional (see README for full list):** `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `LAZADA_APP_KEY`, `LAZADA_APP_SECRET`, `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_REDIRECT_URL`, `TIKTOK_SERVICE_ID`, `STRIPE_SECRET_KEY`, `SENTRY_DSN`, `IMAGEKIT_*`, etc.

---

## Directory Map

```
app/                  Next.js App Router — pages + API routes
  page.tsx            Home page (admin store overview, SSR)
  products/           Product list & detail pages
  orders/             Order list & detail pages
  invoices/           Invoice list & detail pages
  admin/              Admin panel (30+ route groups)
    shopee/           Shopee admin (overview, ads, analytics, orders, products, profit, returns, sync-history)
    lazada/           Lazada admin (overview, orders, products, sync-history)
    products/         Admin product management
    orders/           Admin order management
    invoices/         Admin invoice management
    ...               (categories, suppliers, warehouses, purchase-orders, receiving, etc.)
  api/                API route handlers (39 groups)
    shopee/           Shopee API (auth, sync, products, orders, ads, alerts, stats, webhook — 13 sub-groups)
    lazada/           Lazada API (auth, sync, products, orders — 6 sub-groups)
    auth/             Register, login, logout, session, OAuth
    products/         Product CRUD + import + image upload
    orders/           Order CRUD
    invoices/         Invoice CRUD + PDF + email
    ...               (categories, suppliers, warehouses, payments, shipping, ai, chat, dashboard, etc.)

components/           React components (28 groups)
  ui/                 shadcn/ui primitives (button, dialog, table, etc.)
  layouts/            Navbar, AdminSidebar, PageWithSidebar
  Pages/              Page-level components (HomePage, LoginPage, etc.)
  shopee/             Shopee UI components (20 files)
  lazada/             Lazada UI components (4 files)
  shopee-ads/         Shopee ads dashboard
  ...                 (products, orders, invoices, payments, shipping, etc.)

lib/                  Backend & utility code (31 subdirectories)
  shopee/             Shopee integration (auth, sync, server, token-storage)
  lazada/             Lazada integration (auth, sync, server, custom-api)
  tiktok/             Custom fetch-based TikTok Shop client (signing, types, API, server, sync)
  ai/                 AI insights (OpenCode Zen, Groq, tools)
  api/                API client, rate limiting, CORS, retry, errors
  auth/               Auth utilities, auth-server.ts
  cache/              Redis cache utils
  email/              Brevo email, templates, queue
  server/             Server-side data aggregation (19 modules)
  sync/               Generic sync log lifecycle (runWithSyncLog)
  react-query/        Query client, keys, provider, invalidation
  validations/        Zod schemas (32 files)
  stripe/             Stripe integration
  shippo/             Shippo integration
  monitoring/         Sentry config & wrappers
  ...                 (forecasting, export, import, pdf, notifications, queue, products)

hooks/queries/        TanStack Query hooks (34 hooks)
  use-shopee-ads.ts   Shopee ads query/mutation hooks
  use-products.ts     Product query hooks
  use-orders.ts       Order query hooks
  ...                 (one hook per domain)

contexts/             Auth context (auth-context.tsx)
stores/               Zustand stores (chat, product-store)
types/                TypeScript types (32 type files)
prisma/               Prisma schema + data access helpers
middleware/           Next.js middleware (authMiddleware.ts)
scripts/              Utility scripts (12 scripts)
docs/                 Documentation (7 files)
```

---

## Key Patterns

### API Routes
All under `app/api/<resource>/route.ts`. Use `NextRequest`/`NextResponse`. Auth via `getSession(request)` from `lib/auth`. Validate with Zod from `lib/validations/`. Return JSON with consistent error shape.

### Data Fetching
- **Server Components:** Direct Prisma queries or `lib/server/` aggregation modules
- **Client Components:** TanStack Query hooks from `hooks/queries/` (e.g. `useProducts()`, `useOrders()`)
- **Query Invalidation:** Use `lib/react-query/invalidation.ts` helpers after mutations

### Validation
Zod schemas in `lib/validations/<domain>.ts`. Shared between client forms and API routes. Example: `productSchema`, `orderSchema`.

### Auth Flow
JWT stored in HTTP-only cookie (`session_id`). Middleware in `middleware/authMiddleware.ts` protects routes. Session fetched via `lib/auth-server.ts`. Roles: `admin`, `supplier`, `client`.

### Shopee Integration Flow
1. **OAuth:** `/api/shopee/auth` → Shopee authorize URL → `/api/shopee/callback` (exchange code, store tokens in `ShopeeShop`)
2. **Sync:** `/api/shopee/sync` triggers `lib/shopee/sync/` (products → orders → returns → ads), writes via `lib/shopee/server/`, logs to `ShopeeSyncLog`
3. **Dashboard:** `app/admin/shopee/` pages use `components/shopee/` which call TanStack Query hooks hitting `/api/shopee/*`
4. **Cron:** Daily sync at 2am, SLA alerts every 4h, low-stock alerts every 6h, digests daily/weekly

### Lazada Integration Flow
Similar to Shopee but simpler. OAuth → sync (products/orders) → dashboard. Multi-country support (VN, SG, MY, TH, PH, ID). Custom API implementation in `lib/lazada/custom-api.ts` (SDK had issues).

---

## Database

See **`prisma/schema.prisma`** for the full schema (30+ MongoDB models).

Model groups:
- **Core:** User, Category, Supplier, Product, ProductChannelMapping, Warehouse
- **Orders/Invoicing:** Order, OrderItem, Invoice
- **Stock:** StockAllocation, StockTransfer, StockMovement
- **Purchase Orders:** PurchaseOrder, PurchaseOrderItem
- **Shopee (11):** ShopeeShop, ShopeeProduct, ShopeeProductVariant, ShopeeOrder, ShopeeOrderItem, ShopeeSyncLog, ShopeeReturn, ShopeeAdsDailyPerformance, ShopeeAdsCampaignDailyPerformance
- **Lazada (4):** LazadaShop, LazadaProduct, LazadaOrder, LazadaOrderItem
- **System:** AuditLog, ImportHistory, Notification, SystemConfig, Permission
- **Support:** SupportTicket, SupportTicketReply, ProductReview

---

## Cron Jobs (Vercel `vercel.json`)

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| `/api/shopee/sync/cron` | Daily 2am | Full Shopee sync (products, orders, returns, ads) |
| `/api/shopee/alerts/sla` | Every 4h | SLA breach alerts |
| `/api/shopee/alerts/low-stock` | Every 6h | Low stock alerts |
| `/api/shopee/digest?period=daily` | Daily 8am | Daily summary digest |
| `/api/shopee/digest?period=weekly` | Monday 8am | Weekly summary digest |
| `/api/lazada/sync/cron` | Daily 3am | Full Lazada sync (products, orders) |
| `/api/tiktok/sync/cron`  | Daily 3:30 AM | Products, orders full sync |

---

## Where to Look (Common Agent Tasks)

| Task | Files to Check |
|------|---------------|
| Add a product field | `prisma/schema.prisma` → `lib/validations/product.ts` → `types/product.ts` → `components/products/` |
| Add a Shopee feature | `lib/shopee/` (backend) → `app/api/shopee/` (API) → `components/shopee/` (UI) → `hooks/queries/use-shopee-*.ts` |
| Add a Lazada feature | `lib/lazada/` → `app/api/lazada/` → `components/lazada/` |
| TikTok Shop integration | `lib/tiktok/` (signing, types, custom-api, server, sync), `app/api/tiktok/` (routes), `components/tiktok/` (UI), `app/admin/tiktok/` (pages), `lib/validations/tiktok.ts` |
| Add a new page | `app/<route>/page.tsx` → `components/Pages/` or `components/<domain>/` |
| Add a new API endpoint | `app/api/<resource>/route.ts` → validate with `lib/validations/` |
| Modify auth/permissions | `lib/auth-server.ts` → `middleware/authMiddleware.ts` → `contexts/auth-context.tsx` |
| Change the sidebar | `components/layouts/AdminSidebar.tsx` |
| Modify email templates | `lib/email/templates/` |
| Add a TanStack Query hook | `hooks/queries/use-<domain>.ts` → register in `hooks/queries/index.ts` |
| Debug Shopee sync | `lib/shopee/sync/` → `lib/shopee/server/` → `ShopeeSyncLog` model |
| Check Sentry errors | `lib/monitoring/` → Sentry dashboard |
| Add a Zod validation schema | `lib/validations/<domain>.ts` |
| Modify Prisma schema | `prisma/schema.prisma` → `npx prisma generate` |

---

## Documentation

| File | What's In It |
|------|-------------|
| `README.md` | Full project docs: setup, features, architecture, screenshots |
| `docs/PROJECT_WALKTHROUGH.md` | Agent-oriented codebase map, request flow diagrams, quality gates |
| `docs/Redis_Sentry_PostHog_INTEGRATION_GUIDE.md` | Integration guides |
| `docs/SENTRY_ERRORS.md` | Historical Sentry error cases |
| `docs/VERCEL_PRODUCTION_GUARDRAILS.md` | Production deployment safety |
