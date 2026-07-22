import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, getErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/react-query/config";
import { useToast } from "@/hooks/use-toast";

export function useSourcingWorkspaces() { return useQuery({ queryKey: queryKeys.sourcing.workspaces(), queryFn: async () => (await apiClient.sourcing.workspaces()).data }); }
export function useSourcingMembers(workspaceId: string, enabled = false) { return useQuery({ queryKey: queryKeys.sourcing.members(workspaceId), queryFn: async () => (await apiClient.sourcing.members(workspaceId)).data, enabled: !!workspaceId && enabled }); }
export function useSourcingSuppliers(workspaceId: string) { return useQuery({ queryKey: [...queryKeys.sourcing.all, "suppliers", workspaceId], queryFn: async () => (await apiClient.sourcing.suppliers(workspaceId)).data, enabled: !!workspaceId }); }
export function useSourcingCases(workspaceId: string) { return useQuery({ queryKey: queryKeys.sourcing.cases(workspaceId), queryFn: async () => (await apiClient.sourcing.cases(workspaceId)).data, enabled: !!workspaceId }); }
export function useSourcingCase(id: string) { return useQuery({ queryKey: queryKeys.sourcing.case(id), queryFn: async () => (await apiClient.sourcing.case(id)).data, enabled: !!id }); }

function mutationOptions(queryClient: ReturnType<typeof useQueryClient>, toast: ReturnType<typeof useToast>["toast"], success: string) {
  return { onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.sourcing.all }); toast({ title: success }); }, onError: (error: unknown) => toast({ title: "Sourcing update failed", description: getErrorMessage(error), variant: "destructive" as const }) };
}
export function useCreateSourcingCase() { const queryClient = useQueryClient(); const { toast } = useToast(); return useMutation({ mutationFn: (data: Record<string, unknown>) => apiClient.sourcing.create(data).then((response) => response.data), ...mutationOptions(queryClient, toast, "Sourcing case created") }); }
export function useSourcingCommand() { const queryClient = useQueryClient(); const { toast } = useToast(); return useMutation({ mutationFn: ({ id, ...data }: Record<string, unknown> & { id: string }) => apiClient.sourcing.command(id, data).then((response) => response.data), ...mutationOptions(queryClient, toast, "Sourcing case updated") }); }
