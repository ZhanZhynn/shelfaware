import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/react-query/config";
import type { ProductPerformanceData } from "@/types/product-performance";
export function useProductPerformance(params: { dateFrom: string; dateTo: string; view?: string; page?: number; pageSize?: number; tier?: string; performance?: string; channel?: string; category?: string; search?: string }) {
  return useQuery({ queryKey: queryKeys.productPerformance.report(JSON.stringify(params)), queryFn: async () => (await apiClient.productPerformance.get(params)).data as ProductPerformanceData, staleTime: 300_000 });
}
