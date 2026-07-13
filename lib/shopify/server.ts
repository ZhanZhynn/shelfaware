/**
 * Shopify Server-Side Module
 * Handles OAuth flow, HMAC validation, token exchange, active shop context.
 *
 * Pattern: Same as TikTok's server.ts — module-level activeShopId, Prisma persistence.
 *
 * Key differences:
 * - OAuth: 6 callback params (code, hmac, host, shop, state, timestamp)
 * - HMAC validation via lib/auth/hmac-utils.ts
 * - Offline tokens don't expire (no refresh needed)
 * - Shop identifier is the shop domain (e.g. "mystore.myshopify.com")
 */

import crypto from "crypto";
import prisma from "@/prisma/client";
import { getEnvVar } from "@/lib/env";
import { logger } from "@/lib/logger";
import type {
  ShopifyTokenResponse,
  ShopifyGraphQLResponse,
  ShopifyShopInfo,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────

const SHOPIFY_API_VERSION = "2025-07";
const OAUTH_SCOPES_DEFAULT = "read_products,read_orders";
const OAUTH_TIMESTAMP_TOLERANCE_SEC = 120; // 2 minutes

// ─── Active Shop Context ──────────────────────────────────────────────────

let activeShopDomain: string | null = null;

export function setActiveShop(shopDomain: string): void {
  activeShopDomain = shopDomain;
}

export function getActiveShopDomain(): string | null {
  return activeShopDomain;
}

// ─── Configuration Guard ──────────────────────────────────────────────────

export function isShopifyConfigured(): boolean {
  return !!(
    getEnvVar("SHOPIFY_API_KEY") &&
    getEnvVar("SHOPIFY_API_SECRET") &&
    getEnvVar("SHOPIFY_REDIRECT_URL")
  );
}

// ─── OAuth URL ────────────────────────────────────────────────────────────

/**
 * Generate the Shopify authorization URL for OAuth flow.
 * @param shopDomain The shop domain (e.g. "mystore.myshopify.com")
 * @param state CSRF nonce to verify in callback
 */
export function getShopifyAuthUrl(shopDomain: string, state: string): string {
  const apiKey = getEnvVar("SHOPIFY_API_KEY");
  const redirectUri = getEnvVar("SHOPIFY_REDIRECT_URL");
  const scopes = getEnvVar("SHOPIFY_SCOPES") || OAUTH_SCOPES_DEFAULT;

  const params = new URLSearchParams({
    client_id: apiKey!,
    scope: scopes,
    redirect_uri: redirectUri!,
    state,
  });

  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

// ─── State Nonce (CSRF protection) ────────────────────────────────────────

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const stateStore = new Map<string, { userId: string; shopDomain: string; expiresAt: number }>();

export function generateState(userId: string, shopDomain: string): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  stateStore.set(nonce, {
    userId,
    shopDomain,
    expiresAt: Date.now() + STATE_TTL_MS,
  });
  // Garbage-collect expired entries
  for (const [k, v] of stateStore.entries()) {
    if (v.expiresAt < Date.now()) stateStore.delete(k);
  }
  return nonce;
}

export function verifyState(state: string): { userId: string; shopDomain: string } | null {
  const entry = stateStore.get(state);
  if (!entry) return null;
  stateStore.delete(state); // one-time use
  if (entry.expiresAt < Date.now()) return null;
  return { userId: entry.userId, shopDomain: entry.shopDomain };
}

// ─── HMAC Validation ──────────────────────────────────────────────────────

/**
 * Validate HMAC signature on OAuth callback.
 * Algorithm:
 *   1. Remove `hmac` from query params
 *   2. Sort remaining params alphabetically by key
 *   3. Build "key=value&key=value" message
 *   4. HMAC-SHA256 with client secret
 *   5. timingSafeEqual compare
 */
export function validateShopifyHmac(
  params: Record<string, string>,
  hmac: string,
): boolean {
  const secret = getEnvVar("SHOPIFY_API_SECRET");
  if (!secret) return false;

  const cleaned = Object.entries(params)
    .filter(([k]) => k !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(cleaned)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmac),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

// ─── Shop Domain Validation ───────────────────────────────────────────────

export function isValidShopDomain(domain: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain);
}

// ─── Timestamp Validation ─────────────────────────────────────────────────

export function isTimestampFresh(timestamp: string): boolean {
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.abs(nowSec - ts) <= OAUTH_TIMESTAMP_TOLERANCE_SEC;
}

// ─── Token Exchange ───────────────────────────────────────────────────────

/**
 * Exchange an authorization code for an offline access token.
 * Shopify's offline tokens don't expire and have no refresh token.
 */
export async function exchangeCodeForToken(
  shopDomain: string,
  code: string,
): Promise<ShopifyTokenResponse | null> {
  const apiKey = getEnvVar("SHOPIFY_API_KEY");
  const apiSecret = getEnvVar("SHOPIFY_API_SECRET");

  if (!apiKey || !apiSecret) {
    throw new Error("Shopify is not configured. Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET.");
  }

  const url = `https://${shopDomain}/admin/oauth/access_token`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        code,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error(`[Shopify Auth] Token exchange HTTP ${response.status}: ${text}`);
      return null;
    }

    return (await response.json()) as ShopifyTokenResponse;
  } catch (error) {
    logger.error("[Shopify Auth] Token exchange request failed:", error);
    return null;
  }
}

// ─── GraphQL Client ───────────────────────────────────────────────────────

/**
 * Execute a GraphQL query against the Shopify Admin API.
 * Throws on HTTP errors, GraphQL errors, or throttling.
 */
export async function shopifyGraphQL<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 429) {
    const text = await response.text();
    throw new Error(`Shopify API throttled (429): ${text}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API HTTP ${response.status}: ${text}`);
  }

  const result = (await response.json()) as ShopifyGraphQLResponse<T>;

  if (result.errors && result.errors.length > 0) {
    const messages = result.errors.map((e) => e.message).join("; ");
    throw new Error(`Shopify GraphQL error: ${messages}`);
  }

  if (!result.data) {
    throw new Error("Shopify GraphQL response has no data");
  }

  return result.data;
}

// ─── Shop Info ────────────────────────────────────────────────────────────

/**
 * Fetch basic shop information via GraphQL.
 */
export async function fetchShopInfo(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifyShopInfo | null> {
  const query = `
    query GetShop {
      shop {
        id
        name
        myshopifyDomain
        email
        currencyCode
        primaryDomain { url host }
      }
    }
  `;

  try {
    const data = await shopifyGraphQL<{ shop: ShopifyShopInfo }>(
      shopDomain,
      accessToken,
      query,
    );
    return data.shop;
  } catch (error) {
    logger.error("[Shopify] Failed to fetch shop info:", error);
    return null;
  }
}

// ─── Active Shop Record ───────────────────────────────────────────────────

async function getActiveShopRecord() {
  if (activeShopDomain) {
    return prisma.shopifyShop.findFirst({
      where: { shopDomain: activeShopDomain },
    });
  }
  return prisma.shopifyShop.findFirst({
    orderBy: { updatedAt: "desc" },
  });
}

// ─── Token Validation ─────────────────────────────────────────────────────

/**
 * Validate that the current token can successfully call the Shopify API.
 */
export async function validateShopifyToken(): Promise<{
  valid: boolean;
  error?: string;
}> {
  try {
    const shop = await getActiveShopRecord();
    if (!shop?.accessToken) {
      return { valid: false, error: "No access token available" };
    }

    await shopifyGraphQL<{ shop: { name: string } }>(
      shop.shopDomain,
      shop.accessToken,
      `query { shop { name } }`,
    );
    return { valid: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[Shopify] Token validation failed: ${msg}`);
    return { valid: false, error: msg };
  }
}

// ─── Get Active Access Token ──────────────────────────────────────────────

/**
 * Get the access token for the active shop.
 * Shopify offline tokens don't expire, so no refresh is needed.
 */
export async function getActiveAccessToken(): Promise<string> {
  const shop = await getActiveShopRecord();
  if (!shop?.accessToken) {
    throw new Error("No Shopify shop found or access token missing.");
  }
  return shop.accessToken;
}

// ─── Token Persistence ────────────────────────────────────────────────────

/**
 * Upsert a ShopifyShop record with new tokens.
 * Called after OAuth callback or re-authorization.
 */
export async function persistShopConnection(
  userId: string,
  shopDomain: string,
  shopName: string,
  accessToken: string,
  scopes: string,
): Promise<void> {
  const now = new Date();
  const existing = await prisma.shopifyShop.findFirst({
    where: { shopDomain },
  });

  if (existing) {
    await prisma.shopifyShop.update({
      where: { id: existing.id },
      data: {
        userId,
        shopName,
        accessToken,
        scopes,
        updatedAt: now,
      },
    });
  } else {
    await prisma.shopifyShop.create({
      data: {
        userId,
        shopDomain,
        shopName,
        accessToken,
        scopes,
        createdAt: now,
      },
    });
  }

  logger.info(`[Shopify TokenStorage] Tokens persisted for shop ${shopDomain}`);
}

// ─── GraphQL Query Constants ───────────────────────────────────────────────

export const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      nodes {
        id
        title
        handle
        description
        vendor
        productType
        status
        tags
        totalInventory
        tracksInventory
        featuredImage { url }
        createdAt
        updatedAt
        variants(first: 100) {
          nodes {
            id
            title
            displayName
            sku
            barcode
            price
            compareAtPrice
            inventoryQuantity
            inventoryPolicy
            position
            availableForSale
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const ORDERS_QUERY = `
  query GetOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        email
        createdAt
        updatedAt
        processedAt
        closedAt
        cancelledAt
        cancelReason
        closed
        confirmed
        test
        note
        tags
        currencyCode
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        customer { id email firstName lastName }
        shippingAddress { address1 address2 city province country zip }
        lineItems(first: 100) {
          nodes {
            id
            name
            title
            quantity
            currentQuantity
            unfulfilledQuantity
            sku
            variant { id title sku }
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            discountedUnitPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ─── GraphQL Cost Logging ──────────────────────────────────────────────────

export function logGraphQLCost<T extends { extensions?: { cost?: { requestedQueryCost: number; actualQueryCost: number; throttleStatus: { currentlyAvailable: number; restoreRate: number } } } }>(
  label: string,
  response: T,
): void {
  const cost = response.extensions?.cost;
  if (cost) {
    logger.info(
      `[Shopify API] ${label} cost: ${cost.actualQueryCost}/${cost.requestedQueryCost}, available: ${cost.throttleStatus.currentlyAvailable}/${cost.throttleStatus.restoreRate}/s`,
    );
  }
}
