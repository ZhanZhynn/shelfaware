/**
 * TikTok Shop API — Type Definitions
 * Interfaces referenced from official TikTok Shop Node.js SDK model classes.
 * Covers: Auth/Token, Products (v202502), Orders (v202309).
 */

// ─── Generic Response Wrapper ─────────────────────────────────────────────

export interface TikTokBaseResponse<T> {
  code: number;
  message: string;
  request_id: string;
  data: T;
}

// ─── Auth / Token ─────────────────────────────────────────────────────────

export interface TikTokTokenData {
  access_token: string;
  access_token_expire_in?: number;
  refresh_token: string;
  refresh_token_expire_in?: number;
  open_id?: string;
  seller_name?: string;
  seller_base_region?: string;
  user_type?: number; // 0=Seller, 1=Creator, 3=Partner(TAP)
  request_id?: string;
  granted_scopes?: string[];
}

export interface TikTokShopInfo {
  id: string;
  name: string;
  region: string;
  seller_type: string; // CROSS_BORDER, LOCAL
  cipher: string; // Required for shop-level API calls
  code: string;
}

// ─── Products (v202502) ───────────────────────────────────────────────────

export interface TikTokSearchProductsData {
  products: TikTokProductSummary[];
  total: number;
  more: boolean;
  next_page_token: string;
}

export interface TikTokProductSummary {
  id: string;
  product_id?: string; // Some API versions use product_id
  title: string;
  seller_sku?: string;
  category_id?: string;
  main_image_url?: string;
  status: TikTokProductStatus;
  audit?: { status: string }; // v202502 returns nested object
  audit_status?: string; // Some API versions use flat string
  has_draft?: boolean;
  create_time: number;
  update_time: number;
  skus?: TikTokProductSKU[];
}

export type TikTokProductStatus =
  | "ACTIVATE"
  | "DEACTIVATE"
  | "UNDER_REVIEW"
  | "FAILED"
  | "FROZEN"
  | "DRAFT";

export interface TikTokProductDetail {
  product_id: string;
  title: string;
  description: string;
  category_id: string;
  brand_id: string;
  main_image_url: string;
  status: TikTokProductStatus;
  audit_status: string;
  is_cod_allowed: boolean;
  is_sample_order: boolean;
  create_time: number;
  update_time: number;
  product_certifications: TikTokProductCertification[];
  product_attrs: TikTokProductAttribute[];
  skus: TikTokProductSKU[];
}

export interface TikTokProductCertification {
  certification_name: string;
  certification_url: string;
  certification_type: string;
}

export interface TikTokProductAttribute {
  attribute_id: string;
  attribute_name: string;
  attribute_value_id: string;
  attribute_value_name: string;
}

export interface TikTokProductSKU {
  id: string;
  seller_sku: string;
  sku_price: TikTokSKUPrice;
  inventory: TikTokSKUInventory;
  sales_attrs: TikTokSalesAttribute[];
  image_url: string;
  status: TikTokSKUStatus;
}

export interface TikTokSKUPrice {
  original_price: string;
  price: string;
  currency: string;
}

export interface TikTokSKUInventory {
  total_quantity: number;
  warehouses: TikTokWarehouseInventory[];
}

export interface TikTokWarehouseInventory {
  warehouse_id: string;
  quantity: number;
  backorder_quantity: number;
  handling_time: number;
}

export interface TikTokSalesAttribute {
  attribute_id: string;
  attribute_name: string;
  attribute_value_id: string;
  attribute_value_name: string;
}

export type TikTokSKUStatus = "NORMAL" | "DELETED" | "NOT_SALE";

export interface TikTokGetProductDetailData {
  product: TikTokProductDetail;
}

// ─── Orders (v202309) ────────────────────────────────────────────────────

export interface TikTokSearchOrdersData {
  orders: TikTokOrderSummary[];
  next_page_token: string;
  total_count: number;
}

export interface TikTokOrderSummary {
  id: string;
  status: TikTokOrderStatus;
  create_time: number;
  update_time: number;
  paid_time: number;
  cancel_time: number;
  delivery_time: number;
  user_id: string;
  buyer_email: string;
  buyer_nickname: string;
  is_cod: boolean;
  cancel_reason: string;
  shipping_type: string; // TIKTOK_SHIPPING, SELLER_SHIPPING
  fulfillment_type: string; // FULFILLMENT_BY_SELLER, FULFILLMENT_BY_TIKTOK
  tracking_number: string;
  shipping_provider: string;
  payment: TikTokOrderPayment;
  line_items: TikTokOrderLineItem[];
  recipient_address: TikTokRecipientAddress;
}

export type TikTokOrderStatus =
  | "UNPAID"
  | "ON_HOLD"
  | "AWAITING_SHIPMENT"
  | "PARTIALLY_SHIPPING"
  | "AWAITING_COLLECTION"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED";

export interface TikTokOrderPayment {
  currency: string;
  sub_total: string;
  shipping_fee: string;
  seller_discount: string;
  platform_discount: string;
  payment_platform_discount?: string;
  payment_discount_service_fee?: string;
  total_amount: string;
  original_total_product_price: string;
  original_shipping_fee: string;
  shipping_fee_seller_discount: string;
  shipping_fee_platform_discount: string;
  shipping_fee_cofunded_discount?: string;
  tax: string;
  small_order_fee?: string;
  shipping_fee_tax?: string;
  product_tax?: string;
  retail_delivery_fee?: string;
  buyer_service_fee?: string;
  handling_fee?: string;
  shipping_insurance_fee?: string;
  item_insurance_fee?: string;
  item_insurance_tax?: string;
  distance_shipping_fee?: string;
  distance_fee?: string;
}

export interface TikTokOrderLineItem {
  id: string;
  sku_id: string;
  product_id: string;
  product_name: string;
  sku_name: string;
  sku_image: string;
  seller_sku: string;
  original_price: string;
  sale_price: string;
  platform_discount?: string;
  seller_discount?: string;
  display_status?: string;
  currency?: string;
  package_id?: string;
  package_status?: string;
  is_gift: boolean;
  item_tax?: Array<{ tax_type: string; tax_amount: string; tax_rate: string }>;
  tracking_number?: string;
  cancel_reason?: string;
  cancel_user?: string;
  rts_time?: number;
  combined_listing_skus?: Array<{ sku_id: string; sku_count: number; product_id: string; seller_sku: string }>;
}

export interface TikTokRecipientAddress {
  name: string;
  phone_number: string;
  full_address?: string;
  address_detail?: string;
  address_line1?: string;
  address_line2?: string;
  address_line3?: string;
  address_line4?: string;
  region_code: string;
  postal_code?: string;
  post_town?: string;
  district_info?: TikTokDistrictInfo[];
  delivery_preferences?: { drop_off_location: string };
}

export interface TikTokDistrictInfo {
  address_level_name: string;
  address_name: string;
  address_level: string;
  iso_code: string;
}

export interface TikTokGetOrderDetailData {
  orders: TikTokOrderSummary[];
}
