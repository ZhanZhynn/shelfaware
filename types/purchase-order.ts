export type PurchaseOrderStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "ordered"
  | "shipping"
  | "received"
  | "cancelled";

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  productName: string;
  sku?: string;
  quantity: number;
  quantityReceived: number;
  unitCost: number;
  subtotal: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  userId: string;
  workspaceId?: string | null;
  status: PurchaseOrderStatus;
  totalAmount: number;
  currency?: string;
  convertedTotalMyr?: number | null;
  freightMyr?: number | null;
  dutyMyr?: number | null;
  taxMyr?: number | null;
  insuranceMyr?: number | null;
  localDeliveryMyr?: number | null;
  landedCostAdjustments?: PurchaseOrderLandedCostAdjustment[] | null;
  notes?: string;
  trackingNumber?: string;
  trackingCarrier?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  shippingNotes?: string;
  shippedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  orderedAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
  items: PurchaseOrderItem[];
  createdAt: string;
  updatedAt?: string;
  createdBy: string;
  updatedBy?: string;
  sourcingOrder?: {
    caseId: string;
    sourcingCase: { id: string; title: string; stage: string };
  } | null;
}

export interface PurchaseOrderLandedCostAdjustment {
  id: string;
  amountMyr: number;
  reason: string;
  createdAt: string;
  createdBy?: string;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  currency?: string;
  notes?: string;
  items: {
    productId: string;
    productName: string;
    sku?: string;
    quantity: number;
    unitCost: number;
  }[];
}

export interface UpdatePurchaseOrderInput {
  id: string;
  notes?: string;
  items?: {
    productId: string;
    productName: string;
    sku?: string;
    quantity: number;
    unitCost: number;
  }[];
}

export interface ShipPurchaseOrderInput {
  trackingNumber?: string;
  trackingCarrier?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  shippingNotes?: string;
}
