/**
 * Centralized API Client
 * Single Axios instance used by all hooks in hooks/queries: products, orders, invoices, auth, etc.
 * Sends session cookie (withCredentials) and optional Bearer token; baseURL points to /api.
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import Cookies from "js-cookie";
import { API_ENDPOINTS } from "./endpoints";
import {
  createApiError,
  getErrorMessage,
  isAxiosError,
  type ApiError,
} from "./errors";
import type {
  Product,
  Category,
  Supplier,
  CreateProductInput,
  UpdateProductInput,
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateSupplierInput,
  UpdateSupplierInput,
  LoginInput,
  RegisterInput,
  LoginResponse,
  EmailPreferences,
  UpdateEmailPreferencesInput,
  Order,
  CreateOrderInput,
  UpdateOrderInput,
  Notification,
  UpdateNotificationInput,
  NotificationFilters,
  Invoice,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  InvoiceFilters,
  Warehouse,
  CreateWarehouseInput,
  UpdateWarehouseInput,
  ImportHistoryForPage,
  SupportTicket,
  SupportTicketReply,
  CreateSupportTicketInput,
  CreateSupportTicketReplyInput,
  UpdateSupportTicketInput,
  ProductReview,
  CreateProductReviewInput,
  UpdateProductReviewInput,
  ReviewEligibilitySlot,
  DashboardStats,
  UserForAdmin,
  UpdateUserAdminInput,
  CreateUserAdminInput,
  ClientPortalStats,
  SupplierPortalStats,
  StockAllocation,
  CreateStockAllocationInput,
  WarehouseStockSummary,
  ForecastingSummary,
  SupplierPortalDashboard,
  ClientPortalDashboard,
  ClientCatalogOverview,
  ClientBrowseMeta,
  ClientBrowseProductsResponse,
  CreateCheckoutInput,
  CheckoutSessionResponse,
  GenerateLabelInput,
  GenerateLabelResponse,
  AddTrackingInput,
  GetRatesInput,
  GetRatesResponse,
  SystemConfig,
  UpdateSystemConfigInput,
  AuditLog,
  AuditLogFilters,
  AdminCounts,
  ShopeeShopData,
  ShopeeProductData,
  ShopeeOrderData,
  ShopeeSyncLogData,
  ShopeeStatsData,
} from "@/types";

/**
 * API Response wrapper
 * Standardized response format
 */
export interface ApiResponse<T> {
  data: T;
  status: number;
  statusText: string;
}

/** Builds Axios instance with baseURL (/api), credentials, and request/response interceptors. */
function createAxiosInstance(): AxiosInstance {
  const instance = axios.create({
    baseURL:
      process.env.NODE_ENV === "production"
        ? "https://console.shelfaware.my/api"
        : `${process.env.NEXT_PUBLIC_LOCAL_API_URL || "http://localhost:3000"}/api`,
    headers: {
      "Content-Type": "application/json",
    },
    withCredentials: true, // Ensure cookies are sent with requests
    timeout: 30000, // 30 second timeout
  });

  // Request interceptor - Add auth token
  instance.interceptors.request.use(
    (config) => {
      const token = Cookies.get("session_id");
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    },
  );

  // Response interceptor - Handle errors globally
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (isAxiosError(error)) {
        // Transform AxiosError to ApiError for consistent error handling
        return Promise.reject(createApiError(error));
      }
      return Promise.reject(error);
    },
  );

  return instance;
}

/**
 * API Client class
 * Provides type-safe methods for all API endpoints
 */
class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = createAxiosInstance();
  }

  /**
   * Authentication API methods
   */
  auth = {
    /**
     * Login user
     * Returns: { userId, userName, userEmail, sessionId }
     */
    login: async (data: LoginInput): Promise<ApiResponse<LoginResponse>> => {
      const response = await this.client.post<LoginResponse>(
        API_ENDPOINTS.auth.login,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Register new user
     */
    register: async (
      data: RegisterInput,
    ): Promise<ApiResponse<{ id: string; name: string; email: string }>> => {
      const response = await this.client.post<{
        id: string;
        name: string;
        email: string;
      }>(API_ENDPOINTS.auth.register, data);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Logout user
     */
    logout: async (): Promise<ApiResponse<void>> => {
      const response = await this.client.post<void>(API_ENDPOINTS.auth.logout);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get current session
     */
    getSession: async (): Promise<
      ApiResponse<{
        id: string;
        name: string;
        email: string;
      }>
    > => {
      const response = await this.client.get<{
        id: string;
        name: string;
        email: string;
      }>(API_ENDPOINTS.auth.session);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Products API methods
   */
  products = {
    /**
     * Get all products
     */
    getAll: async (): Promise<ApiResponse<Product[]>> => {
      const response = await this.client.get<Product[]>(
        API_ENDPOINTS.products.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get product by ID
     */
    getById: async (id: string): Promise<ApiResponse<Product>> => {
      const response = await this.client.get<Product>(
        `${API_ENDPOINTS.products.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Create new product
     */
    create: async (data: CreateProductInput): Promise<ApiResponse<Product>> => {
      const response = await this.client.post<Product>(
        API_ENDPOINTS.products.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Update existing product
     * Note: API expects { id, ...productData } in body
     */
    update: async (data: UpdateProductInput): Promise<ApiResponse<Product>> => {
      const response = await this.client.put<Product>(
        API_ENDPOINTS.products.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Delete product
     * Note: App Router API uses query parameter ?id=...
     */
    delete: async (
      id: string,
    ): Promise<ApiResponse<{ success: boolean; mode?: "soft" | "hard" }>> => {
      const response = await this.client.delete<{
        success: boolean;
        mode?: "soft" | "hard";
      }>(`${API_ENDPOINTS.products.base}?id=${id}`);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Lookup product by scanned QR/QR payload or SKU (for receiving)
     */
    lookup: async (q: string) => {
      const response = await this.client.get(
        `${API_ENDPOINTS.productLookup}?q=${encodeURIComponent(q)}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Categories API methods
   */
  categories = {
    /**
     * Get all categories
     */
    getAll: async (): Promise<ApiResponse<Category[]>> => {
      const response = await this.client.get<Category[]>(
        API_ENDPOINTS.categories.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get category by ID
     */
    getById: async (id: string): Promise<ApiResponse<Category>> => {
      const response = await this.client.get<Category>(
        `${API_ENDPOINTS.categories.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Create new category
     */
    create: async (
      data: CreateCategoryInput,
    ): Promise<ApiResponse<Category>> => {
      const response = await this.client.post<Category>(
        API_ENDPOINTS.categories.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Update existing category
     * Note: API expects { id, name } in body
     */
    update: async (
      data: UpdateCategoryInput,
    ): Promise<ApiResponse<Category>> => {
      const response = await this.client.put<Category>(
        API_ENDPOINTS.categories.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Delete category
     * Note: App Router API uses query parameter ?id=...
     */
    delete: async (id: string): Promise<ApiResponse<void>> => {
      const response = await this.client.delete<void>(
        `${API_ENDPOINTS.categories.base}?id=${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Suppliers API methods
   */
  suppliers = {
    /**
     * Get all suppliers
     */
    getAll: async (): Promise<ApiResponse<Supplier[]>> => {
      const response = await this.client.get<Supplier[]>(
        API_ENDPOINTS.suppliers.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get supplier by ID
     */
    getById: async (id: string): Promise<ApiResponse<Supplier>> => {
      const response = await this.client.get<Supplier>(
        `${API_ENDPOINTS.suppliers.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Create new supplier
     */
    create: async (
      data: CreateSupplierInput,
    ): Promise<ApiResponse<Supplier>> => {
      const response = await this.client.post<Supplier>(
        API_ENDPOINTS.suppliers.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Update existing supplier
     * Note: API expects { id, name } in body
     */
    update: async (
      data: UpdateSupplierInput,
    ): Promise<ApiResponse<Supplier>> => {
      const response = await this.client.put<Supplier>(
        API_ENDPOINTS.suppliers.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Delete supplier
     * Note: App Router API uses query parameter ?id=...
     */
    delete: async (id: string): Promise<ApiResponse<void>> => {
      const response = await this.client.delete<void>(
        `${API_ENDPOINTS.suppliers.base}?id=${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Warehouses API methods
   */
  warehouses = {
    getAll: async (): Promise<ApiResponse<Warehouse[]>> => {
      const response = await this.client.get<Warehouse[]>(
        API_ENDPOINTS.warehouses.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getById: async (id: string): Promise<ApiResponse<Warehouse>> => {
      const response = await this.client.get<Warehouse>(
        `${API_ENDPOINTS.warehouses.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    create: async (
      data: CreateWarehouseInput,
    ): Promise<ApiResponse<Warehouse>> => {
      const response = await this.client.post<Warehouse>(
        API_ENDPOINTS.warehouses.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    update: async (
      data: UpdateWarehouseInput,
    ): Promise<ApiResponse<Warehouse>> => {
      const response = await this.client.put<Warehouse>(
        API_ENDPOINTS.warehouses.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    delete: async (id: string): Promise<ApiResponse<void>> => {
      const response = await this.client.delete<void>(
        `${API_ENDPOINTS.warehouses.base}?id=${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Import History (Admin History) API methods
   */
  importHistory = {
    getAll: async (): Promise<ApiResponse<ImportHistoryForPage[]>> => {
      const response = await this.client.get<ImportHistoryForPage[]>(
        API_ENDPOINTS.importHistory.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getById: async (id: string): Promise<ApiResponse<ImportHistoryForPage>> => {
      const response = await this.client.get<ImportHistoryForPage>(
        `${API_ENDPOINTS.importHistory.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Support Tickets API methods
   */
  supportTickets = {
    getAll: async (params?: {
      view?: "all" | "assigned_to_me" | "created_by_me";
    }): Promise<ApiResponse<SupportTicket[]>> => {
      const url =
        params?.view && params.view !== "all"
          ? `${API_ENDPOINTS.supportTickets.base}?view=${params.view}`
          : API_ENDPOINTS.supportTickets.base;
      const response = await this.client.get<SupportTicket[]>(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getById: async (id: string): Promise<ApiResponse<SupportTicket>> => {
      const response = await this.client.get<SupportTicket>(
        `${API_ENDPOINTS.supportTickets.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    create: async (
      data: CreateSupportTicketInput,
    ): Promise<ApiResponse<SupportTicket>> => {
      const response = await this.client.post<SupportTicket>(
        API_ENDPOINTS.supportTickets.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    update: async (
      id: string,
      data: UpdateSupportTicketInput,
    ): Promise<ApiResponse<SupportTicket>> => {
      const response = await this.client.put<SupportTicket>(
        `${API_ENDPOINTS.supportTickets.base}/${id}`,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    delete: async (id: string): Promise<ApiResponse<{ success: boolean }>> => {
      const response = await this.client.delete<{ success: boolean }>(
        `${API_ENDPOINTS.supportTickets.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getReplies: async (
      id: string,
    ): Promise<ApiResponse<SupportTicketReply[]>> => {
      const response = await this.client.get<SupportTicketReply[]>(
        `${API_ENDPOINTS.supportTickets.base}/${id}/replies`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    createReply: async (
      id: string,
      data: CreateSupportTicketReplyInput,
    ): Promise<ApiResponse<SupportTicketReply>> => {
      const response = await this.client.post<SupportTicketReply>(
        `${API_ENDPOINTS.supportTickets.base}/${id}/replies`,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Product Reviews API methods
   */
  productReviews = {
    getAll: async (): Promise<ApiResponse<ProductReview[]>> => {
      const response = await this.client.get<ProductReview[]>(
        API_ENDPOINTS.productReviews.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getById: async (id: string): Promise<ApiResponse<ProductReview>> => {
      const response = await this.client.get<ProductReview>(
        `${API_ENDPOINTS.productReviews.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getEligibility: async (
      productId: string,
      orderId?: string,
    ): Promise<
      ApiResponse<{ eligible: boolean; slots: ReviewEligibilitySlot[] }>
    > => {
      const params: { productId: string; orderId?: string } = { productId };
      if (orderId) params.orderId = orderId;
      const response = await this.client.get<{
        eligible: boolean;
        slots: ReviewEligibilitySlot[];
      }>(`${API_ENDPOINTS.productReviews.base}/eligibility`, {
        params,
      });
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getByProductId: async (
      productId: string,
      status?: "approved" | "pending" | "all",
    ): Promise<ApiResponse<ProductReview[]>> => {
      const params = status ? { status } : {};
      const response = await this.client.get<ProductReview[]>(
        `${API_ENDPOINTS.productReviews.base}/by-product/${productId}`,
        { params },
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    create: async (
      data: CreateProductReviewInput,
    ): Promise<ApiResponse<ProductReview>> => {
      const response = await this.client.post<ProductReview>(
        API_ENDPOINTS.productReviews.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    update: async (
      id: string,
      data: UpdateProductReviewInput,
    ): Promise<ApiResponse<ProductReview>> => {
      const response = await this.client.put<ProductReview>(
        `${API_ENDPOINTS.productReviews.base}/${id}`,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    delete: async (id: string): Promise<ApiResponse<{ success: boolean }>> => {
      const response = await this.client.delete<{ success: boolean }>(
        `${API_ENDPOINTS.productReviews.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Dashboard (admin overview) API methods
   */
  dashboard = {
    getOverview: async (): Promise<ApiResponse<DashboardStats>> => {
      const response = await this.client.get<DashboardStats>(
        API_ENDPOINTS.dashboard.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Users (admin User Management) API methods
   */
  users = {
    getAll: async (): Promise<ApiResponse<UserForAdmin[]>> => {
      const response = await this.client.get<UserForAdmin[]>(
        API_ENDPOINTS.users.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getById: async (id: string): Promise<ApiResponse<UserForAdmin>> => {
      const response = await this.client.get<UserForAdmin>(
        `${API_ENDPOINTS.users.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    update: async (
      id: string,
      data: UpdateUserAdminInput,
    ): Promise<ApiResponse<UserForAdmin>> => {
      const response = await this.client.put<UserForAdmin>(
        `${API_ENDPOINTS.users.base}/${id}`,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    create: async (
      data: CreateUserAdminInput,
    ): Promise<ApiResponse<UserForAdmin>> => {
      const response = await this.client.post<UserForAdmin>(
        API_ENDPOINTS.users.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    delete: async (id: string): Promise<ApiResponse<UserForAdmin>> => {
      const response = await this.client.delete<UserForAdmin>(
        `${API_ENDPOINTS.users.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Admin Client Portal API methods
   */
  clientPortal = {
    getOverview: async (): Promise<ApiResponse<ClientPortalStats>> => {
      const response = await this.client.get<ClientPortalStats>(
        API_ENDPOINTS.clientPortal.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Admin Supplier Portal API methods
   */
  supplierPortal = {
    getOverview: async (): Promise<ApiResponse<SupplierPortalStats>> => {
      const response = await this.client.get<SupplierPortalStats>(
        API_ENDPOINTS.supplierPortal.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Stock Allocations API methods
   */
  stockAllocations = {
    getAll: async (): Promise<ApiResponse<StockAllocation[]>> => {
      const response = await this.client.get<StockAllocation[]>(
        API_ENDPOINTS.stockAllocations.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getSummary: async (): Promise<ApiResponse<WarehouseStockSummary[]>> => {
      const response = await this.client.get<WarehouseStockSummary[]>(
        `${API_ENDPOINTS.stockAllocations.base}?summary=true`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getByWarehouse: async (
      warehouseId: string,
    ): Promise<ApiResponse<StockAllocation[]>> => {
      const response = await this.client.get<StockAllocation[]>(
        `${API_ENDPOINTS.stockAllocations.base}?warehouseId=${warehouseId}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    create: async (
      data: CreateStockAllocationInput,
    ): Promise<ApiResponse<StockAllocation>> => {
      const response = await this.client.post<StockAllocation>(
        API_ENDPOINTS.stockAllocations.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Forecasting API methods
   */
  forecasting = {
    getSummary: async (): Promise<ApiResponse<ForecastingSummary>> => {
      const response = await this.client.get<ForecastingSummary>(
        API_ENDPOINTS.forecasting.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * ABC Analysis API methods
   */
  abcAnalysis = {
    get: async (params?: {
      dateFrom?: string;
      dateTo?: string;
      channel?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.dateFrom) searchParams.set("dateFrom", params.dateFrom);
      if (params?.dateTo) searchParams.set("dateTo", params.dateTo);
      if (params?.channel) searchParams.set("channel", params.channel);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.inventory.abcAnalysis}?${qs}`
        : API_ENDPOINTS.inventory.abcAnalysis;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * P&L Report API methods
   */
  financials = {
    getPnl: async (params?: {
      period?: string;
      dateFrom?: string;
      dateTo?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.period) searchParams.set("period", params.period);
      if (params?.dateFrom) searchParams.set("dateFrom", params.dateFrom);
      if (params?.dateTo) searchParams.set("dateTo", params.dateTo);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.financials.pnl}?${qs}`
        : API_ENDPOINTS.financials.pnl;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Purchase Orders API methods
   */
  purchaseOrders = {
    getAll: async (params?: {
      status?: string;
      supplierId?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set("status", params.status);
      if (params?.supplierId) searchParams.set("supplierId", params.supplierId);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.purchaseOrders.base}?${qs}`
        : API_ENDPOINTS.purchaseOrders.base;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getById: async (id: string) => {
      const response = await this.client.get(
        API_ENDPOINTS.purchaseOrders.detail(id),
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    create: async (data: Record<string, unknown>) => {
      const response = await this.client.post(
        API_ENDPOINTS.purchaseOrders.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    update: async (id: string, data: Record<string, unknown>) => {
      const response = await this.client.put(
        API_ENDPOINTS.purchaseOrders.detail(id),
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    delete: async (id: string) => {
      const response = await this.client.delete(
        API_ENDPOINTS.purchaseOrders.detail(id),
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    approve: async (id: string, data: { action: "approve" | "reject" }) => {
      const response = await this.client.post(
        API_ENDPOINTS.purchaseOrders.approve(id),
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    generate: async () => {
      const response = await this.client.post(
        API_ENDPOINTS.purchaseOrders.generate,
        {},
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Executive KPI API methods
   */
  executiveKpi = {
    get: async (params?: {
      dateFrom?: string;
      dateTo?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.dateFrom) searchParams.set("dateFrom", params.dateFrom);
      if (params?.dateTo) searchParams.set("dateTo", params.dateTo);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.executiveKpi.base}?${qs}`
        : API_ENDPOINTS.executiveKpi.base;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
    * Lazada API methods
    */
  lazada = {
    getAuthUrl: async (): Promise<ApiResponse<{ url: string }>> => {
      const response = await this.client.get<{ url: string }>(
        API_ENDPOINTS.lazada.auth,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getShops: async (): Promise<ApiResponse<Array<{
      id: string;
      sellerId: string;
      sellerName: string;
      countryCode: string | null;
      lastSyncedAt: string | null;
      createdAt: string;
    }>>> => {
      const response = await this.client.get(
        API_ENDPOINTS.lazada.shops,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getProducts: async (params?: {
      sellerId?: string;
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
    }): Promise<ApiResponse<{
      products: Array<{
        id: string;
        lazadaItemId: number;
        itemName: string;
        sellerSku: string | null;
        status: string;
        price: number;
        stock: number;
        imageUrl: string | null;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>> => {
      const searchParams = new URLSearchParams();
      if (params?.sellerId) searchParams.set("sellerId", params.sellerId);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.search) searchParams.set("search", params.search);
      if (params?.status) searchParams.set("status", params.status);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.lazada.products}?${qs}`
        : API_ENDPOINTS.lazada.products;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getOrders: async (params?: {
      sellerId?: string;
      page?: number;
      limit?: number;
      status?: string;
    }): Promise<ApiResponse<{
      orders: Array<{
        id: string;
        lazadaOrderId: string;
        orderNumber: string | null;
        orderStatus: string;
        totalAmount: number;
        customerFirstName: string | null;
        lazadaCreatedAt: string | null;
        items: Array<{ productName: string; quantity: number; price: number }>;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>> => {
      const searchParams = new URLSearchParams();
      if (params?.sellerId) searchParams.set("sellerId", params.sellerId);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.status) searchParams.set("status", params.status);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.lazada.orders}?${qs}`
        : API_ENDPOINTS.lazada.orders;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    triggerSync: async (data: {
      sellerId: string;
      syncType: "products" | "orders" | "all";
    }): Promise<ApiResponse<{ success: boolean; message?: string }>> => {
      const response = await this.client.post(API_ENDPOINTS.lazada.sync, data);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getSyncLogs: async (
      sellerId?: string,
    ): Promise<ApiResponse<Array<{
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
    }>>> => {
      const url = sellerId
        ? `${API_ENDPOINTS.lazada.syncLogs}?sellerId=${sellerId}`
        : API_ENDPOINTS.lazada.syncLogs;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getStats: async (
      sellerId?: string,
      dateFrom?: string,
      dateTo?: string,
    ): Promise<ApiResponse<{
      totalProducts: number;
      totalOrders: number;
      totalRevenue: number;
      averageOrderValue: number;
      ordersByStatus: Record<string, number>;
      topProducts: { name: string; revenue: number; quantity: number }[];
      lastSyncedAt: string | null;
    }>> => {
      const params = new URLSearchParams();
      if (sellerId) params.set("sellerId", sellerId);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const qs = params.toString();
      const url = qs
        ? `${API_ENDPOINTS.lazada.stats}?${qs}`
        : API_ENDPOINTS.lazada.stats;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getRevenueTrend: async (
      granularity: "daily" | "weekly" | "monthly" = "daily",
      sellerId?: string,
      dateFrom?: string,
      dateTo?: string,
    ): Promise<
      ApiResponse<{
        data: { period: string; revenue: number; orders: number }[];
        granularity: string;
      }>
    > => {
      const searchParams = new URLSearchParams();
      searchParams.set("granularity", granularity);
      if (sellerId) searchParams.set("sellerId", sellerId);
      if (dateFrom) searchParams.set("dateFrom", dateFrom);
      if (dateTo) searchParams.set("dateTo", dateTo);
      const url = `${API_ENDPOINTS.lazada.revenueTrend}?${searchParams.toString()}`;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
    * TikTok Shop API methods
    */
  tiktok = {
    getAuthUrl: async (): Promise<ApiResponse<{ url: string }>> => {
      const response = await this.client.get<{ url: string }>(
        API_ENDPOINTS.tiktok.auth,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getShops: async (): Promise<ApiResponse<Array<{
      id: string;
      shopId: string;
      shopName: string;
      region: string | null;
      sellerType: string | null;
      lastSyncedAt: string | null;
      createdAt: string;
    }>>> => {
      const response = await this.client.get(
        API_ENDPOINTS.tiktok.shops,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getProducts: async (params?: {
      shopId?: string;
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
    }): Promise<ApiResponse<{
      products: Array<{
        id: string;
        tiktokProductId: string;
        title: string;
        status: string;
        mainImageUrl: string | null;
        auditStatus: string | null;
        variants: Array<{ price: number; totalQuantity: number }>;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>> => {
      const searchParams = new URLSearchParams();
      if (params?.shopId) searchParams.set("shopId", params.shopId);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.search) searchParams.set("search", params.search);
      if (params?.status) searchParams.set("status", params.status);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.tiktok.products}?${qs}`
        : API_ENDPOINTS.tiktok.products;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getOrders: async (params?: {
      shopId?: string;
      page?: number;
      limit?: number;
      status?: string;
    }): Promise<ApiResponse<{
      orders: Array<{
        id: string;
        tiktokOrderId: string;
        orderStatus: string;
        buyerNickname: string | null;
        totalAmount?: number;
        payment?: Record<string, unknown>;
        tiktokCreatedAt: string | null;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>> => {
      const searchParams = new URLSearchParams();
      if (params?.shopId) searchParams.set("shopId", params.shopId);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.status) searchParams.set("status", params.status);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.tiktok.orders}?${qs}`
        : API_ENDPOINTS.tiktok.orders;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    triggerSync: async (data: {
      shopId: string;
      syncType?: "products" | "orders" | "all";
    }): Promise<ApiResponse<unknown>> => {
      const response = await this.client.post(
        API_ENDPOINTS.tiktok.sync,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getSyncLogs: async (
      shopId?: string,
    ): Promise<ApiResponse<Array<{
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
    }>>> => {
      const url = shopId
        ? `${API_ENDPOINTS.tiktok.syncLogs}?shopId=${shopId}`
        : API_ENDPOINTS.tiktok.syncLogs;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Shopify API methods
   */
  shopify = {
    getAuthUrl: async (shop: string): Promise<ApiResponse<{ url: string; state: string }>> => {
      const response = await this.client.get<{ url: string; state: string }>(
        `${API_ENDPOINTS.shopify.auth}?shop=${encodeURIComponent(shop)}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getShops: async (): Promise<ApiResponse<Array<{
      id: string;
      shopDomain: string;
      shopName: string;
      scopes: string;
      lastSyncedAt: string | null;
      createdAt: string;
    }>>> => {
      const response = await this.client.get(
        API_ENDPOINTS.shopify.shops,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getProducts: async (params?: {
      shopId?: string;
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
    }): Promise<ApiResponse<{
      products: Array<{
        id: string;
        shopifyProductId: string;
        title: string;
        status: string;
        featuredImageUrl: string | null;
        variants: Array<{ price: number; inventoryQuantity: number }>;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>> => {
      const searchParams = new URLSearchParams();
      if (params?.shopId) searchParams.set("shopId", params.shopId);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.search) searchParams.set("search", params.search);
      if (params?.status) searchParams.set("status", params.status);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.shopify.products}?${qs}`
        : API_ENDPOINTS.shopify.products;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getOrders: async (params?: {
      shopId?: string;
      page?: number;
      limit?: number;
      status?: string;
    }): Promise<ApiResponse<{
      orders: Array<{
        id: string;
        shopifyOrderId: string;
        orderName: string;
        orderStatus: string;
        financialStatus: string | null;
        totalAmount: number;
        currency: string;
        createdAt: string | null;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>> => {
      const searchParams = new URLSearchParams();
      if (params?.shopId) searchParams.set("shopId", params.shopId);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.status) searchParams.set("status", params.status);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.shopify.orders}?${qs}`
        : API_ENDPOINTS.shopify.orders;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    triggerSync: async (data: {
      shopId: string;
      syncType?: "products" | "orders" | "all";
    }): Promise<ApiResponse<unknown>> => {
      const response = await this.client.post(
        API_ENDPOINTS.shopify.sync,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getSyncLogs: async (
      shopId?: string,
    ): Promise<ApiResponse<Array<{
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
    }>>> => {
      const url = shopId
        ? `${API_ENDPOINTS.shopify.syncLogs}?shopId=${shopId}`
        : API_ENDPOINTS.shopify.syncLogs;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getStats: async (
      shopId?: string,
      dateFrom?: string,
      dateTo?: string,
    ): Promise<ApiResponse<{
      totalProducts: number;
      totalOrders: number;
      totalRevenue: number;
      averageOrderValue: number;
      ordersByStatus: Record<string, number>;
      topProducts: { name: string; revenue: number; quantity: number }[];
      lastSyncedAt: string | null;
    }>> => {
      const params = new URLSearchParams();
      if (shopId) params.set("shopId", shopId);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const qs = params.toString();
      const url = qs
        ? `${API_ENDPOINTS.shopify.stats}?${qs}`
        : API_ENDPOINTS.shopify.stats;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getRevenueTrend: async (
      granularity: "daily" | "weekly" | "monthly" = "daily",
      shopId?: string,
      dateFrom?: string,
      dateTo?: string,
    ): Promise<
      ApiResponse<{
        data: { period: string; revenue: number; orders: number }[];
        granularity: string;
      }>
    > => {
      const searchParams = new URLSearchParams();
      searchParams.set("granularity", granularity);
      if (shopId) searchParams.set("shopId", shopId);
      if (dateFrom) searchParams.set("dateFrom", dateFrom);
      if (dateTo) searchParams.set("dateTo", dateTo);
      const url = `${API_ENDPOINTS.shopify.revenueTrend}?${searchParams.toString()}`;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
    * Shopee Ads API methods
    */
  shopeeAds = {
    get: async (params?: {
      dateFrom?: string;
      dateTo?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.dateFrom) searchParams.set("dateFrom", params.dateFrom);
      if (params?.dateTo) searchParams.set("dateTo", params.dateTo);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.shopee.ads}?${qs}`
        : API_ENDPOINTS.shopee.ads;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
    * Receiving API methods (warehouse stock-in by scan)
    */
  receiving = {
    create: async (data: {
      warehouseId: string;
      poId?: string;
      items: { productId: string; sku?: string; quantity: number; poItemId?: string; notes?: string }[];
      notes?: string;
    }) => {
      const response = await this.client.post(API_ENDPOINTS.receiving.base, data);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getMovements: async (params?: {
      productId?: string;
      warehouseId?: string;
      sourceType?: string;
      limit?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.productId) searchParams.set("productId", params.productId);
      if (params?.warehouseId) searchParams.set("warehouseId", params.warehouseId);
      if (params?.sourceType) searchParams.set("sourceType", params.sourceType);
      if (params?.limit) searchParams.set("limit", String(params.limit));
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.receiving.movements}?${qs}`
        : API_ENDPOINTS.receiving.movements;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
    * Portal API methods (external supplier/client portals)
    */
  portal = {
    getSupplierDashboard: async (): Promise<
      ApiResponse<SupplierPortalDashboard>
    > => {
      const response = await this.client.get<SupplierPortalDashboard>(
        API_ENDPOINTS.portal.supplier,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getClientDashboard: async (): Promise<
      ApiResponse<ClientPortalDashboard>
    > => {
      const response = await this.client.get<ClientPortalDashboard>(
        API_ENDPOINTS.portal.client,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getClientCatalog: async (): Promise<ApiResponse<ClientCatalogOverview>> => {
      const response = await this.client.get<ClientCatalogOverview>(
        API_ENDPOINTS.portal.clientCatalog,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getClientBrowseMeta: async (): Promise<ApiResponse<ClientBrowseMeta>> => {
      const response = await this.client.get<ClientBrowseMeta>(
        API_ENDPOINTS.portal.clientBrowseMeta,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    getClientBrowseProducts: async (params: {
      ownerId: string;
      supplierId?: string;
      categoryId?: string;
    }): Promise<ApiResponse<ClientBrowseProductsResponse>> => {
      const searchParams = new URLSearchParams();
      searchParams.set("ownerId", params.ownerId);
      if (params.supplierId) searchParams.set("supplierId", params.supplierId);
      if (params.categoryId) searchParams.set("categoryId", params.categoryId);
      const url = `${API_ENDPOINTS.portal.clientBrowseProducts}?${searchParams.toString()}`;
      const response = await this.client.get<ClientBrowseProductsResponse>(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Payments API methods
   */
  payments = {
    createCheckout: async (
      data: CreateCheckoutInput,
    ): Promise<ApiResponse<CheckoutSessionResponse>> => {
      const response = await this.client.post<CheckoutSessionResponse>(
        API_ENDPOINTS.payments.checkout,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Shipping API methods
   */
  shipping = {
    getRates: async (
      data: GetRatesInput,
    ): Promise<ApiResponse<GetRatesResponse>> => {
      const response = await this.client.post<GetRatesResponse>(
        API_ENDPOINTS.shipping.rates,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    generateLabel: async (
      data: GenerateLabelInput,
    ): Promise<ApiResponse<GenerateLabelResponse>> => {
      const response = await this.client.post<GenerateLabelResponse>(
        API_ENDPOINTS.shipping.labels,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    addTracking: async (
      data: AddTrackingInput,
    ): Promise<ApiResponse<GenerateLabelResponse>> => {
      const response = await this.client.post<GenerateLabelResponse>(
        API_ENDPOINTS.shipping.tracking,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * System Configuration API methods
   */
  systemConfig = {
    getAll: async (): Promise<
      ApiResponse<{
        configs: SystemConfig[];
        categories: Record<string, string>;
      }>
    > => {
      const response = await this.client.get<{
        configs: SystemConfig[];
        categories: Record<string, string>;
      }>(API_ENDPOINTS.systemConfig.base);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    update: async (
      configs: UpdateSystemConfigInput[],
    ): Promise<ApiResponse<{ success: boolean; message: string }>> => {
      const response = await this.client.put<{
        success: boolean;
        message: string;
      }>(API_ENDPOINTS.systemConfig.base, { configs });
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Audit Logs API methods
   */
  auditLogs = {
    getAll: async (
      filters?: AuditLogFilters & { page?: number; limit?: number },
    ): Promise<
      ApiResponse<{
        logs: AuditLog[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      }>
    > => {
      const params = new URLSearchParams();
      if (filters?.page) params.append("page", String(filters.page));
      if (filters?.limit) params.append("limit", String(filters.limit));
      if (filters?.userId) params.append("userId", filters.userId);
      if (filters?.action) params.append("action", filters.action);
      if (filters?.entityType) params.append("entityType", filters.entityType);
      if (filters?.startDate) params.append("startDate", filters.startDate);
      if (filters?.endDate) params.append("endDate", filters.endDate);
      if ((filters as { period?: string })?.period)
        params.append("period", (filters as { period?: string }).period!);

      const url = `${API_ENDPOINTS.auditLogs.base}${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await this.client.get<{
        logs: AuditLog[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      }>(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * User API methods
   */
  user = {
    /**
     * Get email preferences
     */
    getEmailPreferences: async (): Promise<ApiResponse<EmailPreferences>> => {
      const response = await this.client.get<
        { success: boolean; data: EmailPreferences } | EmailPreferences
      >(API_ENDPOINTS.user.emailPreferences);
      // Handle both response formats (with wrapper or direct)
      const data =
        (response.data as { success?: boolean; data?: EmailPreferences })
          .data || (response.data as EmailPreferences);
      return {
        data: data as EmailPreferences,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Update email preferences
     */
    updateEmailPreferences: async (
      data: UpdateEmailPreferencesInput,
    ): Promise<ApiResponse<EmailPreferences>> => {
      const response = await this.client.put<
        { success: boolean; data: EmailPreferences } | EmailPreferences
      >(API_ENDPOINTS.user.emailPreferences, data);
      // Handle both response formats (with wrapper or direct)
      const responseData =
        (response.data as { success?: boolean; data?: EmailPreferences })
          .data || (response.data as EmailPreferences);
      return {
        data: responseData as EmailPreferences,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Orders API methods
   */
  orders = {
    /**
     * Get all orders
     */
    getAll: async (): Promise<ApiResponse<Order[]>> => {
      const response = await this.client.get<Order[]>(
        API_ENDPOINTS.orders.base,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get order by ID
     */
    getById: async (id: string): Promise<ApiResponse<Order>> => {
      const response = await this.client.get<Order>(
        `${API_ENDPOINTS.orders.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Create new order
     */
    create: async (data: CreateOrderInput): Promise<ApiResponse<Order>> => {
      const response = await this.client.post<Order>(
        API_ENDPOINTS.orders.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Update existing order
     */
    update: async (
      id: string,
      data: UpdateOrderInput,
    ): Promise<ApiResponse<Order>> => {
      const response = await this.client.put<Order>(
        `${API_ENDPOINTS.orders.base}/${id}`,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Delete/Cancel order
     */
    delete: async (id: string): Promise<ApiResponse<Order>> => {
      const response = await this.client.delete<Order>(
        `${API_ENDPOINTS.orders.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Admin API methods (client orders = orders containing my products)
   */
  admin = {
    getClientOrders: async (): Promise<ApiResponse<Order[]>> => {
      const response = await this.client.get<Order[]>(
        API_ENDPOINTS.admin.clientOrders,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
    getClientInvoices: async (): Promise<ApiResponse<Invoice[]>> => {
      const response = await this.client.get<Invoice[]>(
        API_ENDPOINTS.admin.clientInvoices,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
    getCounts: async (): Promise<ApiResponse<AdminCounts>> => {
      const response = await this.client.get<AdminCounts>(
        API_ENDPOINTS.admin.counts,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Notifications API methods
   */
  notifications = {
    /**
     * Get all notifications for the authenticated user
     */
    getAll: async (
      filters?: NotificationFilters,
    ): Promise<ApiResponse<Notification[]>> => {
      const params = new URLSearchParams();
      if (filters?.read !== undefined) {
        params.append("read", filters.read.toString());
      }
      if (filters?.type && filters.type.length > 0) {
        filters.type.forEach((type) => params.append("type", type));
      }
      if (filters?.limit) {
        params.append("limit", filters.limit.toString());
      }

      const queryString = params.toString();
      const url = queryString
        ? `${API_ENDPOINTS.notifications.inApp}?${queryString}`
        : API_ENDPOINTS.notifications.inApp;

      const response = await this.client.get<Notification[]>(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get unread notification count
     */
    getUnreadCount: async (): Promise<ApiResponse<{ count: number }>> => {
      const response = await this.client.get<{ count: number }>(
        API_ENDPOINTS.notifications.unreadCount,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get notification by ID
     */
    getById: async (id: string): Promise<ApiResponse<Notification>> => {
      const response = await this.client.get<Notification>(
        `${API_ENDPOINTS.notifications.inApp}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Update notification (mark as read/unread)
     */
    update: async (
      id: string,
      data: UpdateNotificationInput,
    ): Promise<ApiResponse<Notification>> => {
      const response = await this.client.put<Notification>(
        `${API_ENDPOINTS.notifications.inApp}/${id}`,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Mark all notifications as read
     */
    markAllAsRead: async (): Promise<ApiResponse<{ count: number }>> => {
      const response = await this.client.put<{ count: number }>(
        `${API_ENDPOINTS.notifications.inApp}/mark-all-read`,
        {},
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Delete notification
     */
    delete: async (id: string): Promise<ApiResponse<void>> => {
      const response = await this.client.delete<void>(
        `${API_ENDPOINTS.notifications.inApp}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Invoices API methods
   */
  invoices = {
    /**
     * Get all invoices for the authenticated user
     */
    getAll: async (
      filters?: InvoiceFilters,
    ): Promise<ApiResponse<Invoice[]>> => {
      const params = new URLSearchParams();
      if (filters?.searchTerm) {
        params.append("searchTerm", filters.searchTerm);
      }
      if (filters?.status && filters.status.length > 0) {
        filters.status.forEach((status) => params.append("status", status));
      }
      if (filters?.orderId) {
        params.append("orderId", filters.orderId);
      }
      if (filters?.clientId) {
        params.append("clientId", filters.clientId);
      }
      if (filters?.startDate) {
        params.append("startDate", filters.startDate);
      }
      if (filters?.endDate) {
        params.append("endDate", filters.endDate);
      }
      if (filters?.dueDateStart) {
        params.append("dueDateStart", filters.dueDateStart);
      }
      if (filters?.dueDateEnd) {
        params.append("dueDateEnd", filters.dueDateEnd);
      }

      const queryString = params.toString();
      const url = queryString
        ? `${API_ENDPOINTS.invoices.base}?${queryString}`
        : API_ENDPOINTS.invoices.base;

      const response = await this.client.get<Invoice[]>(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get invoice by ID
     */
    getById: async (id: string): Promise<ApiResponse<Invoice>> => {
      const response = await this.client.get<Invoice>(
        `${API_ENDPOINTS.invoices.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Create new invoice from order
     */
    create: async (data: CreateInvoiceInput): Promise<ApiResponse<Invoice>> => {
      const response = await this.client.post<Invoice>(
        API_ENDPOINTS.invoices.base,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Update existing invoice
     */
    update: async (
      id: string,
      data: UpdateInvoiceInput,
    ): Promise<ApiResponse<Invoice>> => {
      const response = await this.client.put<Invoice>(
        `${API_ENDPOINTS.invoices.base}/${id}`,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Delete invoice
     */
    delete: async (id: string): Promise<ApiResponse<void>> => {
      const response = await this.client.delete<void>(
        `${API_ENDPOINTS.invoices.base}/${id}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Send invoice via email
     */
    send: async (
      id: string,
    ): Promise<
      ApiResponse<{ success: boolean; message: string; invoice: Invoice }>
    > => {
      const response = await this.client.post<{
        success: boolean;
        message: string;
        invoice: Invoice;
      }>(`${API_ENDPOINTS.invoices.base}/${id}/send`, {});
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };

  /**
   * Shopee Integration API methods
   */
  shopee = {
    /**
     * Get OAuth authorization URL
     */
    getAuthUrl: async (): Promise<ApiResponse<{ url: string }>> => {
      const response = await this.client.get<{ url: string }>(
        API_ENDPOINTS.shopee.auth,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * List connected Shopee shops
     */
    getShops: async (): Promise<ApiResponse<ShopeeShopData[]>> => {
      const response = await this.client.get<ShopeeShopData[]>(
        API_ENDPOINTS.shopee.shops,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get shop detail
     */
    getShop: async (id: string): Promise<ApiResponse<ShopeeShopData>> => {
      const response = await this.client.get<ShopeeShopData>(
        API_ENDPOINTS.shopee.shopDetail(id),
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Disconnect (remove) a Shopee shop
     */
    disconnectShop: async (
      id: string,
    ): Promise<ApiResponse<{ success: boolean }>> => {
      const response = await this.client.delete<{ success: boolean }>(
        API_ENDPOINTS.shopee.shopDetail(id),
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Trigger sync for a shop
     */
    triggerSync: async (data: {
      shopId: number;
      syncType: "products" | "orders" | "returns" | "ads" | "all";
      daysBack?: number;
    }): Promise<
      ApiResponse<{
        products?: {
          synced: number;
          created: number;
          updated: number;
          errors: string[];
        };
        orders?: {
          synced: number;
          created: number;
          updated: number;
          errors: string[];
        };
        returns?: {
          synced: number;
          created: number;
          updated: number;
          errors: string[];
        };
        ads?: {
          synced: number;
          campaigns: number;
          errors: string[];
        };
      }>
    > => {
      const response = await this.client.post(API_ENDPOINTS.shopee.sync, data);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get sync history logs
     */
    getSyncLogs: async (
      shopId?: string,
    ): Promise<ApiResponse<ShopeeSyncLogData[]>> => {
      const url = shopId
        ? `${API_ENDPOINTS.shopee.syncLogs}?shopId=${shopId}`
        : API_ENDPOINTS.shopee.syncLogs;
      const response = await this.client.get<ShopeeSyncLogData[]>(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * List Shopee products (from local DB)
     */
    getProducts: async (params?: {
      shopId?: string;
      page?: number;
      limit?: number;
      search?: string;
    }): Promise<
      ApiResponse<{
        products: ShopeeProductData[];
        total: number;
        page: number;
        limit: number;
        lowStockThreshold: number;
      }>
    > => {
      const searchParams = new URLSearchParams();
      if (params?.shopId) searchParams.set("shopId", params.shopId);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.search) searchParams.set("search", params.search);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.shopee.products}?${qs}`
        : API_ENDPOINTS.shopee.products;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get Shopee product detail
     */
    getProduct: async (id: string): Promise<ApiResponse<ShopeeProductData>> => {
      const response = await this.client.get<ShopeeProductData>(
        API_ENDPOINTS.shopee.productDetail(id),
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * List Shopee orders (from local DB)
     */
    getOrders: async (params?: {
      shopId?: string;
      page?: number;
      limit?: number;
      status?: string;
    }): Promise<
      ApiResponse<{
        orders: ShopeeOrderData[];
        total: number;
        page: number;
        limit: number;
      }>
    > => {
      const searchParams = new URLSearchParams();
      if (params?.shopId) searchParams.set("shopId", params.shopId);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.status) searchParams.set("status", params.status);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.shopee.orders}?${qs}`
        : API_ENDPOINTS.shopee.orders;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get Shopee order detail
     */
    getOrder: async (id: string): Promise<ApiResponse<ShopeeOrderData>> => {
      const response = await this.client.get<ShopeeOrderData>(
        API_ENDPOINTS.shopee.orderDetail(id),
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get aggregated Shopee stats
     */
    getStats: async (
      shopId?: string,
      dateFrom?: string,
      dateTo?: string,
    ): Promise<ApiResponse<ShopeeStatsData>> => {
      const params = new URLSearchParams();
      if (shopId) params.set("shopId", shopId);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const qs = params.toString();
      const url = qs
        ? `${API_ENDPOINTS.shopee.stats}?${qs}`
        : API_ENDPOINTS.shopee.stats;
      const response = await this.client.get<ShopeeStatsData>(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get revenue trend data
     */
    getRevenueTrend: async (
      granularity: "daily" | "weekly" | "monthly" = "daily",
      shopId?: string,
      dateFrom?: string,
      dateTo?: string,
    ): Promise<
      ApiResponse<{
        data: { period: string; revenue: number; orders: number }[];
        granularity: string;
      }>
    > => {
      const searchParams = new URLSearchParams();
      searchParams.set("granularity", granularity);
      if (shopId) searchParams.set("shopId", shopId);
      if (dateFrom) searchParams.set("dateFrom", dateFrom);
      if (dateTo) searchParams.set("dateTo", dateTo);
      const url = `${API_ENDPOINTS.shopee.revenueTrend}?${searchParams.toString()}`;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get buyer analytics
     */
    getBuyerAnalytics: async (
      shopId?: string,
    ): Promise<
      ApiResponse<{
        totalBuyers: number;
        repeatBuyers: number;
        repeatRate: number;
        avgOrdersPerBuyer: number;
        topBuyers: {
          username: string;
          totalSpent: number;
          orderCount: number;
        }[];
        geographicDistribution: { region: string; count: number }[];
        spendingTiers: { tier: string; count: number }[];
      }>
    > => {
      const url = shopId
        ? `${API_ENDPOINTS.shopee.buyers}?shopId=${shopId}`
        : API_ENDPOINTS.shopee.buyers;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get product performance metrics
     */
    getProductPerformance: async (
      shopId?: string,
    ): Promise<
      ApiResponse<{
        products: {
          id: string;
          shopeeItemId: number;
          itemName: string;
          price: number;
          stock: number;
          imageUrl: string | null;
          quantitySold30d: number;
          revenue30d: number;
          dailySalesRate: number;
          daysUntilStockout: number | null;
          stockTurnover: number | null;
          isSlowMoving: boolean;
          isOutOfStock: boolean;
          isLowStock: boolean;
          performanceRating: string;
        }[];
        summary: {
          totalProducts: number;
          lowStock: number;
          outOfStock: number;
          slowMoving: number;
          excellentPerformers: number;
          goodPerformers: number;
        };
        lowStockThreshold: number;
      }>
    > => {
      const url = shopId
        ? `${API_ENDPOINTS.shopee.productPerformance}?shopId=${shopId}`
        : API_ENDPOINTS.shopee.productPerformance;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get profit tracking data
     */
    getProfitData: async (
      shopId?: string,
    ): Promise<
      ApiResponse<{
        summary: {
          totalRevenue: number;
          totalCommission: number;
          totalServiceFee: number;
          totalSellerTxnFee: number;
          totalShippingFee: number;
          totalSellerIncome: number;
          totalFees: number;
          overallMargin: number;
          totalOrders: number;
          avgOrderValue: number;
          avgFeePerOrder: number;
        };
        byProduct: {
          productName: string;
          revenue: number;
          quantitySold: number;
          orderCount: number;
          estimatedFees: number;
          estimatedProfit: number;
          margin: number;
        }[];
        feeBreakdown: {
          name: string;
          amount: number;
          percentage: number;
        }[];
      }>
    > => {
      const url = shopId
        ? `${API_ENDPOINTS.shopee.profit}?shopId=${shopId}`
        : API_ENDPOINTS.shopee.profit;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get shipping fee discrepancy data
     */
    getShippingDiscrepancy: async (
      shopId?: string,
      threshold: number = 10,
    ): Promise<
      ApiResponse<{
        summary: {
          totalOrders: number;
          ordersWithDiscrepancy: number;
          totalEstimated: number;
          totalActual: number;
          totalDiscrepancy: number;
          threshold: number;
        };
        products: {
          productName: string;
          orderCount: number;
          totalEstimated: number;
          totalActual: number;
          avgDiscrepancy: number;
          discrepancyPct: number;
          totalRevenue: number;
          totalQuantity: number;
        }[];
      }>
    > => {
      const params = new URLSearchParams();
      if (shopId) params.set("shopId", shopId);
      params.set("threshold", String(threshold));
      const url = `${API_ENDPOINTS.shopee.shippingDiscrepancy}?${params.toString()}`;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Test webhook endpoint
     */
    testWebhook: async (): Promise<
      ApiResponse<{ status: string; timestamp: string }>
    > => {
      const response = await this.client.get(API_ENDPOINTS.shopee.webhook);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get CLV (Customer Lifetime Value) analytics
     */
    getClvAnalytics: async (
      shopId?: string,
    ): Promise<
      ApiResponse<{
        summary: {
          totalBuyers: number;
          avgClv: number;
          avgRecency: number;
          avgFrequency: number;
          avgMonetary: number;
        };
        segments: {
          champions: number;
          loyal: number;
          potential: number;
          atRisk: number;
          lost: number;
        };
        churnRisk: { high: number; medium: number; low: number };
        topBuyersByClv: {
          username: string;
          clvEstimate: number;
          orderCount: number;
          avgOrderValue: number;
          recencyDays: number;
          totalSpent: number;
        }[];
      }>
    > => {
      const url = shopId
        ? `${API_ENDPOINTS.shopee.clv}?shopId=${shopId}`
        : API_ENDPOINTS.shopee.clv;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get returns list
     */
    getReturns: async (params?: {
      shopId?: string;
      page?: number;
      limit?: number;
      status?: string;
    }): Promise<
      ApiResponse<{
        returns: Record<string, unknown>[];
        total: number;
        page: number;
        limit: number;
      }>
    > => {
      const searchParams = new URLSearchParams();
      if (params?.shopId) searchParams.set("shopId", params.shopId);
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.status) searchParams.set("status", params.status);
      const qs = searchParams.toString();
      const url = qs
        ? `${API_ENDPOINTS.shopee.returns}?${qs}`
        : API_ENDPOINTS.shopee.returns;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get returns stats
     */
    getReturnsStats: async (
      shopId?: string,
    ): Promise<
      ApiResponse<{
        summary: {
          totalReturns: number;
          totalRefundAmount: number;
          returnRate: number;
          avgRefund: number;
        };
        byStatus: { status: string; count: number }[];
        topReasons: { reason: string; count: number }[];
        recentReturns: Record<string, unknown>[];
      }>
    > => {
      const url = shopId
        ? `${API_ENDPOINTS.shopee.returnsStats}?shopId=${shopId}`
        : API_ENDPOINTS.shopee.returnsStats;
      const response = await this.client.get(url);
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Import orders from Shopee Seller Center Excel export
     */
    importFromExcel: async (
      formData: FormData,
    ): Promise<
      ApiResponse<{
        success: boolean;
        imported: number;
        orders: number;
        created: number;
        updated: number;
        itemsCreated: number;
        errors: string[];
        warnings: string[];
        fileName: string;
        shopName: string;
      }>
    > => {
      const response = await this.client.post(
        API_ENDPOINTS.shopee.import,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Get orders near their ship-by SLA deadline
     */
    getNearSlaOrders: async (
      hours: number = 24,
      shopId?: string,
    ): Promise<
      ApiResponse<{
        total: number;
        thresholdHours: number;
        orders: {
          id: string;
          orderId: string;
          orderStatus: string;
          shipByDate: string | null;
          hoursRemaining: number;
          urgency: "critical" | "high" | "medium";
          buyerUsername: string | null;
          totalAmount: number;
          packageNumber: string | null;
          fulfillmentStatus: string | null;
          daysToShip: number | null;
        }[];
      }>
    > => {
      const searchParams = new URLSearchParams();
      searchParams.set("hours", String(hours));
      if (shopId) searchParams.set("shopId", shopId);
      const response = await this.client.get(
        `${API_ENDPOINTS.shopee.nearSlaOrders}?${searchParams.toString()}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Create WMS product from Shopee listing
     */
    createWmsProduct: async (data: {
      shopeeProductId: string;
      categoryId: string;
      supplierId: string;
    }) => {
      const response = await this.client.post(
        API_ENDPOINTS.shopee.createWmsProduct,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Check mapping status for Shopee products
     */
    getMappingStatus: async (shopeeProductIds: string[]) => {
      const params = new URLSearchParams();
      params.set("ids", shopeeProductIds.join(","));
      const response = await this.client.get(
        `${API_ENDPOINTS.shopee.createWmsProduct}?${params.toString()}`,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    /**
     * Bulk create WMS products from Shopee listings
     */
    bulkCreateWmsProducts: async (data: {
      shopeeProductIds: string[];
      categoryId: string;
      supplierId: string;
    }) => {
      const response = await this.client.post(
        API_ENDPOINTS.shopee.createWmsProduct,
        data,
      );
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };
}

/**
 * Singleton API client instance
 * Export single instance for use throughout the application
 */
export const apiClient = new ApiClient();

/**
 * Export error utilities for use in components
 */
export {
  getErrorMessage,
  isAuthError,
  isNetworkError,
  type ApiError,
} from "./errors";
