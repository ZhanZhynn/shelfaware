import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, getErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/react-query/config";
import { useToast } from "@/hooks/use-toast";

export function useSourcingWorkspaces() {
  return useQuery({
    queryKey: queryKeys.sourcing.workspaces(),
    queryFn: async () => (await apiClient.sourcing.workspaces()).data,
  });
}
export function useSourcingMembers(workspaceId: string, enabled = false) {
  return useQuery({
    queryKey: queryKeys.sourcing.members(workspaceId),
    queryFn: async () => (await apiClient.sourcing.members(workspaceId)).data,
    enabled: !!workspaceId && enabled,
  });
}
export function useSourcingSuppliers(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.all, "suppliers", workspaceId],
    queryFn: async () => (await apiClient.sourcing.suppliers(workspaceId)).data,
    enabled: !!workspaceId,
  });
}
export function useSourcingCases(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.sourcing.cases(workspaceId),
    queryFn: async () => (await apiClient.sourcing.cases(workspaceId)).data,
    enabled: !!workspaceId,
  });
}
export function useSourcingCase(id: string) {
  return useQuery({
    queryKey: queryKeys.sourcing.case(id),
    queryFn: async () => (await apiClient.sourcing.case(id)).data,
    enabled: !!id,
  });
}
export function useSourcingAttachments(id: string) {
  return useQuery({
    queryKey: queryKeys.sourcing.attachments(id),
    queryFn: async () => (await apiClient.sourcing.attachments(id)).data,
    enabled: !!id,
  });
}
export function useSourcingTemplates(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.all, "templates", workspaceId],
    queryFn: async () => (await apiClient.sourcing.templates(workspaceId)).data,
    enabled: !!workspaceId,
  });
}
export function useSourcingDuplicates(workspaceId: string, title: string) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.all, "duplicates", workspaceId, title],
    queryFn: async () =>
      (await apiClient.sourcing.duplicates(workspaceId, title)).data,
    enabled: !!workspaceId && title.trim().length >= 3,
    staleTime: 10_000,
  });
}
export function useSourcingAnalytics(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.all, "analytics", workspaceId],
    queryFn: async () => (await apiClient.sourcing.analytics(workspaceId)).data,
    enabled: !!workspaceId,
  });
}
export function useSourcingSlaSettings(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.all, "sla-settings", workspaceId],
    queryFn: async () =>
      (await apiClient.sourcing.slaSettings(workspaceId)).data,
    enabled: !!workspaceId,
  });
}
export function useSourcingCostSettings(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.all, "cost-settings", workspaceId],
    queryFn: async () =>
      (await apiClient.sourcing.costSettings(workspaceId)).data,
    enabled: !!workspaceId,
  });
}
export function useSourcingCostScenarios(caseId: string, enabled = false) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.all, "cost-scenarios", caseId],
    queryFn: async () => (await apiClient.sourcing.costScenarios(caseId)).data,
    enabled: !!caseId && enabled,
  });
}
export function useSourcingSlaPerformance(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.all, "sla-performance", workspaceId],
    queryFn: async () =>
      (await apiClient.sourcing.slaPerformance(workspaceId)).data,
    enabled: !!workspaceId,
  });
}
export function useSupplierScorecard(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.sourcing.all, "supplier-scorecard", workspaceId],
    queryFn: async () =>
      (await apiClient.sourcing.supplierScorecard(workspaceId)).data,
    enabled: !!workspaceId,
  });
}

function mutationOptions(
  queryClient: ReturnType<typeof useQueryClient>,
  toast: ReturnType<typeof useToast>["toast"],
  success: string,
) {
  return {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.all });
      toast({ title: success });
    },
    onError: (error: unknown) =>
      toast({
        title: "Sourcing update failed",
        description: getErrorMessage(error),
        variant: "destructive" as const,
      }),
  };
}
export function useCreateSourcingCase() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.sourcing.create(data).then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Sourcing case created"),
  });
}
export function useCreateSourcingTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.sourcing.createTemplate(data).then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Sourcing template saved"),
  });
}
export function useLandedCostEstimate() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.sourcing.landedCost(data).then((response) => response.data),
    onError: (error: unknown) =>
      toast({
        title: "Could not calculate landed cost",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });
}
export function useCreateSupplierEvaluation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.sourcing
        .createSupplierEvaluation(data)
        .then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Supplier evaluation saved"),
  });
}
export function useImportSourcingCases() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (data: FormData) =>
      apiClient.sourcing.import(data).then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Sourcing cases imported"),
  });
}
export function useBulkUpdateSourcingCases() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.sourcing.bulk(data).then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Sourcing cases updated"),
  });
}
export function useUpdateSourcingSlaSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({
      workspaceId,
      ...data
    }: Record<string, unknown> & { workspaceId: string }) =>
      apiClient.sourcing
        .updateSlaSettings(workspaceId, data)
        .then((response) => response.data),
    ...mutationOptions(queryClient, toast, "SLA settings saved"),
  });
}
export function useUpdateSourcingCostSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({
      workspaceId,
      ...data
    }: Record<string, unknown> & { workspaceId: string }) =>
      apiClient.sourcing
        .updateCostSettings(workspaceId, data)
        .then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Cost settings saved"),
  });
}
export function useCreateSourcingCostScenario() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.sourcing
        .createCostScenario(data)
        .then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Cost scenario saved"),
  });
}
export function useUpdateSourcingCostScenario() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, ...data }: Record<string, unknown> & { id: string }) =>
      apiClient.sourcing
        .updateCostScenario(id, data)
        .then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Cost scenario updated"),
  });
}
export function useDeleteSourcingCostScenario() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient.sourcing
        .deleteCostScenario(id)
        .then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Cost scenario deleted"),
  });
}
export function useUpdateSourcingNextAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, ...data }: Record<string, unknown> & { id: string }) =>
      apiClient.sourcing
        .updateNextAction(id, data)
        .then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Next action updated"),
  });
}
export function useSourcingCommand() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, ...data }: Record<string, unknown> & { id: string }) =>
      apiClient.sourcing.command(id, data).then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Sourcing case updated"),
  });
}
export function useCreateSourcingComment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      body: string;
      mentionedUserIds?: string[];
    }) =>
      apiClient.sourcing.addComment(id, data).then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Comment added"),
  });
}
export function useUploadSourcingAttachment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, file, quoteId }: { id: string; file: File; quoteId?: string }) =>
      apiClient.sourcing
        .uploadAttachment(id, file, quoteId)
        .then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Attachment uploaded"),
  });
}
export function useDeleteSourcingAttachment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, attachmentId }: { id: string; attachmentId: string }) =>
      apiClient.sourcing
        .deleteAttachment(id, attachmentId)
        .then((response) => response.data),
    ...mutationOptions(queryClient, toast, "Attachment deleted"),
  });
}
