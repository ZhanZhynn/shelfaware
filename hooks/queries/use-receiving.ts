import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/react-query/config";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/api/errors";
import type { ReceiveResult, StockMovementRecord } from "@/types/receiving";

export function useReceiveItems() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: {
      warehouseId: string;
      poId?: string;
      items: { productId: string; sku?: string; quantity: number; poItemId?: string; notes?: string }[];
      notes?: string;
    }) => {
      const response = await apiClient.receiving.create(data);
      return response.data as ReceiveResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.receiving.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stockAllocation.all });
      toast({
        title: "Stock received",
        description: `${data.received.length} item(s) received successfully${data.poStatus ? ` · PO status: ${data.poStatus}` : ""}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Receiving failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });
}

export function useStockMovements(filters?: {
  productId?: string;
  warehouseId?: string;
  sourceType?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: queryKeys.receiving.movements(filters ? JSON.stringify(filters) : undefined),
    queryFn: async () => {
      const response = await apiClient.receiving.getMovements(filters);
      return response.data as StockMovementRecord[];
    },
    staleTime: 1000 * 60 * 2,
  });
}

export function useProductLookup(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lookupText: string) => queryClient.fetchQuery({
      queryKey: queryKeys.productLookup(lookupText, workspaceId),
      queryFn: async () => {
        const response = await apiClient.products.lookup(lookupText, workspaceId);
        return response.data as {
        productId: string;
        sku: string;
        name: string;
        price: number;
        quantity: number;
        imageUrl?: string;
      };
      },
      staleTime: 1000 * 30,
    }),
    retry: false,
  });
}
