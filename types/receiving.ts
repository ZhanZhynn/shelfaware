export interface ReceiveItemInput {
  productId: string;
  sku?: string;
  quantity: number;
  poItemId?: string;
  notes?: string;
}

export interface ReceiveInput {
  warehouseId: string;
  poId?: string;
  items: ReceiveItemInput[];
  notes?: string;
}

export interface ReceivedItemResult {
  productId: string;
  sku?: string;
  quantity: number;
  newStockLevel: number;
  poItemStatus?: { quantityOrdered: number; quantityReceived: number; fullyReceived: boolean };
}

export interface ReceiveResult {
  received: ReceivedItemResult[];
  poStatus?: string;
}

export interface ProductLookupResult {
  productId: string;
  sku: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
}

export interface StockMovementRecord {
  id: string;
  productId: string;
  productName?: string;
  warehouseId: string;
  warehouseName?: string;
  quantity: number;
  type: string;
  sourceType?: string;
  sourceId?: string;
  poItemId?: string;
  receivedById: string;
  receivedByName?: string;
  receivedAt: string;
  notes?: string;
}
