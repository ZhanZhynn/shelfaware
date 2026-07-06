import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/react-query/config";
import type { ShopeeAdsData } from "@/types/shopee-ads";

export function useShopeeAds(params?: { dateFrom?: string; dateTo?: string }) {
  return useQuery({
    queryKey: queryKeys.shopeeAds.report(params ? JSON.stringify(params) : undefined),
    queryFn: async () => {
      const response = await apiClient.shopeeAds.get(params);
      return response.data as ShopeeAdsData;
    },
    staleTime: 1000 * 60 * 5,
  });
}
