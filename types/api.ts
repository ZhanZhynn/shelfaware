/**
 * API Response Types
 * Standardized response format for all API endpoints
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * API Error Response
 * Standardized error format for all API endpoints
 */
export interface ApiError {
  success: false;
  error: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

/**
 * Validation Error
 * For form validation and request validation errors
 */
export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationErrorResponse extends ApiError {
  errors: ValidationError[];
}

/**
 * Admin sidebar badge counts (Orders, Invoices, Support Tickets, Product Reviews,
 * Products, Warehouses, Supplier Portal, Client Portal, User Management).
 */
export interface AdminCounts {
  clientOrders: number;
  clientInvoices: number;
  supportTickets: number;
  productReviews: number;
  products: number;
  warehouses: number;
  suppliers: number;
  clients: number;
  users: number;
}

// =============================================================================
// Shopee Integration Types
// =============================================================================

export interface ShopeeShopData {
  id: string;
  shopId: number;
  shopName: string;
  shopStatus: string;
  region: string;
  merchantId: number | null;
  isCb: boolean | null;
  lastSyncedAt: string | null;
  createdAt: string;
  lowStockThreshold: number;
}

export interface ShopeeProductData {
  id: string;
  shopId: string;
  shopeeItemId: number;
  itemName: string;
  description: string | null;
  categoryId: number | null;
  price: number;
  originalPrice: number | null;
  stock: number;
  imageUrl: string | null;
  status: string;
  models: unknown;
  weight: number | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface ShopeeOrderData {
  id: string;
  shopId: string;
  shopeeOrderId: string;
  orderStatus: string;
  paymentStatus: string | null;
  totalAmount: number;
  currency: string | null;
  region: string | null;
  buyerUsername: string | null;
  shippingAddress: unknown;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  logisticsStatus: string | null;
  shopeeCreatedAt: string | null;
  shopeeUpdatedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  commissionFee: number;
  serviceFee: number;
  sellerTxnFee: number;
  shippingFee: number;
  sellerIncome: number;
  buyerPaymentMethod: string | null;
  // SLA fields
  shipByDate: string | null;
  packageNumber: string | null;
  fulfillmentStatus: string | null;
  daysToShip: number | null;
  createdAt: string;
  items: ShopeeOrderItemData[];
}

export interface ShopeeSlaAlert {
  id: string;
  orderId: string;
  orderStatus: string;
  shipByDate: string;
  hoursRemaining: number;
  urgency: "critical" | "high" | "medium";
  buyerUsername: string | null;
  totalAmount: number;
  packageNumber: string | null;
  fulfillmentStatus: string | null;
}

export interface ShopeeOrderItemData {
  id: string;
  shopeeModelId: number | null;
  productName: string;
  sku: string | null;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface ShopeeSyncLogData {
  id: string;
  syncType: string;
  status: string;
  itemsSynced: number;
  itemsCreated: number;
  itemsUpdated: number;
  errors: string[] | null;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
}

export interface ShopeeStatsData {
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  ordersByStatus: Record<string, number>;
  topProducts: { name: string; revenue: number; quantity: number }[];
  lastSyncedAt: string | null;
}
