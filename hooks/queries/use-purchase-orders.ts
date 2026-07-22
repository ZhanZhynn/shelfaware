import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/react-query/config";
import { getErrorMessage } from "@/lib/api/errors";
import type { PurchaseOrder } from "@/types/purchase-order";

export function usePurchaseOrders(filters?: { status?: string; supplierId?: string }) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.list(filters),
    queryFn: async () => {
      const response = await apiClient.purchaseOrders.getAll(filters);
      return response.data as PurchaseOrder[];
    },
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.detail(id),
    queryFn: async () => {
      const response = await apiClient.purchaseOrders.getById(id);
      return response.data as PurchaseOrder;
    },
    enabled: !!id,
  });
}

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const response = await apiClient.purchaseOrders.create(data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      toast({ title: "Purchase order created" });
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });
}

export function useUpdatePurchaseOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...data }: Record<string, unknown> & { id: string }) => {
      const response = await apiClient.purchaseOrders.update(id, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      toast({ title: "Purchase order updated" });
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });
}

export function useDeletePurchaseOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.purchaseOrders.delete(id);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      toast({ title: "Purchase order cancelled" });
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });
}

export function useApprovePurchaseOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      const response = await apiClient.purchaseOrders.approve(id, { action });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      toast({ title: "Purchase order updated" });
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });
}

export function useGeneratePurchaseOrders() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.purchaseOrders.generate();
      return response.data;
    },
    onSuccess: (data: unknown) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      const count = Array.isArray(data) ? data.length : 0;
      toast({ title: `Generated ${count} purchase order(s)` });
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });
}

export function useShipPurchaseOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...data }: Record<string, unknown> & { id: string }) => {
      const response = await apiClient.purchaseOrders.ship(id, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.all });
      toast({ title: "Purchase order marked as shipped" });
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });
}

export function useUpdateShippingInfo() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...data }: Record<string, unknown> & { id: string }) => {
      const response = await apiClient.purchaseOrders.updateShipping(id, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.all });
      toast({ title: "Shipping info updated" });
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });
}

export function useUpdatePONotes() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const response = await apiClient.purchaseOrders.updateNotes(id, { notes });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.all });
      toast({ title: "Notes updated" });
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });
}
