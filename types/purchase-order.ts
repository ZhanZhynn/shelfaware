export type PurchaseOrderStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "ordered"
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
  status: PurchaseOrderStatus;
  totalAmount: number;
  notes?: string;
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
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
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
