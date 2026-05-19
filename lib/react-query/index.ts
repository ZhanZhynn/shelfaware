/**
 * TanStack Query exports
 * Centralized export point for React Query utilities.
 * After CRUD, call invalidateAllRelatedQueries from mutation hooks (see npm run test:invalidate).
 */

export { createQueryClient, queryKeys } from "./config";
export { QueryProvider } from "./provider";
export { invalidateAllRelatedQueries } from "./invalidate-all";

