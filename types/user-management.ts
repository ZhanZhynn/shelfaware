/**
 * User Management (admin) type definitions
 */

export type UserRole =
  | "user"
  | "admin"
  | "sourcer"
  | "supplier"
  | "client"
  | "retailer";
export type UserAccountType =
  | "user"
  | "workspace_admin"
  | "super_admin"
  | "sourcer"
  | "supplier"
  | "client"
  | "retailer";
export type UserStatus = "pending" | "approved" | "rejected";

export interface UserOverview {
  orderCount: number;
  invoiceCount: number;
  totalRevenue: number;
  totalSpent: number;
  totalDue: number;
  productCount: number;
  supplierCount: number;
  categoryCount: number;
  warehouseCount: number;
}

export interface UserForAdmin {
  id: string;
  email: string;
  name: string;
  username: string | null;
  role: UserRole | null;
  status: UserStatus;
  image: string | null;
  isSuperAdmin: boolean;
  createdAt: string;
  updatedAt: string | null;
  workspaceAdminOf?: { workspaceId: string; workspaceName: string }[];
  overview?: UserOverview;
}

export interface UpdateUserAdminInput {
  role?: UserRole | null;
  name?: string;
  status?: UserStatus;
  isSuperAdmin?: boolean;
  workspaceAdminWorkspaceIds?: string[];
}

export interface CreateUserAdminInput {
  email: string;
  name: string;
  password: string;
  username?: string;
  role?: UserRole | null;
  accountType?: UserAccountType;
  workspaceIds?: string[];
}

export interface UserManagementFilters {
  role?: UserRole | UserRole[];
  status?: UserStatus;
  search?: string;
}
