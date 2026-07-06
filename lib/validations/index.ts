/**
 * Validation schemas exports
 * Centralized export point for all Zod validation schemas
 */

// Product validations
export {
  productSchema,
  productFormSubmitSchema,
  createProductBodySchema,
  createProductSchema,
  updateProductBodySchema,
  updateProductSchema,
  generateProductQrCodeBodySchema,
  calculateProductStatus,
  type ProductFormData,
} from "./product";

export {
  createCheckoutBodySchema,
  type CreateCheckoutBody,
} from "./payment";

export {
  shippoAddressSchema,
  parcelDimensionsSchema,
  getRatesBodySchema,
  generateLabelBodySchema,
  addTrackingBodySchema,
} from "./shipping";

export {
  updateInAppNotificationBodySchema,
  emailNotificationBodySchema,
} from "./notification";

export {
  updateSystemConfigsBodySchema,
  type UpdateSystemConfigsBody,
} from "./system-config";

export { aiInsightsBodySchema, type AiInsightsBody } from "./ai";

// Auth validations
export {
  registerSchema,
  registerBodySchema,
  loginSchema,
  loginBodySchema,
  type RegisterFormData,
  type LoginFormData,
} from "./auth";

// Category validations
export {
  createCategoryBodySchema,
  createCategorySchema,
  updateCategoryBodySchema,
  updateCategorySchema,
  type CategoryFormData,
} from "./category";

// Supplier validations
export {
  createSupplierBodySchema,
  createSupplierSchema,
  updateSupplierBodySchema,
  updateSupplierSchema,
  type SupplierFormData,
} from "./supplier";

// Warehouse validations
export {
  createWarehouseBodySchema,
  updateWarehouseBodySchema,
  type CreateWarehouseBody,
  type UpdateWarehouseBody,
} from "./warehouse";

// Order validations
export {
  createOrderSchema,
  updateOrderSchema,
  shippingAddressSchema,
  billingAddressSchema,
  orderItemSchema,
  type CreateOrderFormData,
  type UpdateOrderFormData,
} from "./order";

// Invoice validations
export {
  createInvoiceSchema,
  updateInvoiceSchema,
  type CreateInvoiceFormData,
  type UpdateInvoiceFormData,
} from "./invoice";

// Support Ticket validations
export {
  createSupportTicketSchema,
  createSupportTicketReplySchema,
  updateSupportTicketSchema,
  type CreateSupportTicketFormData,
  type UpdateSupportTicketFormData,
} from "./support-ticket";

// Product Review validations
export {
  createProductReviewSchema,
  updateProductReviewSchema,
  type CreateProductReviewFormData,
  type UpdateProductReviewFormData,
} from "./product-review";

// User Management (admin) validations
export {
  updateUserAdminSchema,
  createUserAdminSchema,
  type UpdateUserAdminFormData,
  type CreateUserAdminFormData,
} from "./user-management";

export {
  createStockAllocationSchema,
  updateStockAllocationSchema,
  createStockTransferSchema,
  type CreateStockAllocationFormData,
  type UpdateStockAllocationFormData,
  type CreateStockTransferFormData,
} from "./stock-allocation";

// Shopee validations
export {
  shopeeSyncBodySchema,
  shopeeProductListQuerySchema,
  shopeeOrderListQuerySchema,
  shopeeShopDisconnectSchema,
  shopeeCallbackQuerySchema,
  type ShopeeSyncBody,
  type ShopeeProductListQuery,
  type ShopeeOrderListQuery,
  type ShopeeShopDisconnect,
  type ShopeeCallbackQuery,
} from "./shopee";

// Receiving validations
export {
  receiveItemSchema,
  receiveBodySchema,
  type ReceiveBody,
} from "./receiving";
