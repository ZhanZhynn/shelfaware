/**
 * User Management (admin) validation schemas
 */

import { z } from "zod";

const userRoleEnum = z.enum([
  "user",
  "admin",
  "sourcer",
  "supplier",
  "client",
  "retailer",
]);

const userStatusEnum = z.enum(["pending", "approved", "rejected"]);
const userAccountTypeEnum = z.enum([
  "user",
  "workspace_admin",
  "super_admin",
  "sourcer",
  "supplier",
  "client",
  "retailer",
]);
const workspaceIds = z
  .array(z.string().min(1))
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Workspaces must be unique",
  );

export const updateUserAdminSchema = z.object({
  role: userRoleEnum.nullable().optional(),
  name: z.string().min(1, "Name is required").max(200).optional(),
  status: userStatusEnum.optional(),
  isSuperAdmin: z.boolean().optional(),
  workspaceAdminWorkspaceIds: workspaceIds.optional(),
});

export const createUserAdminSchema = z
  .object({
    email: z.string().email("Valid email is required"),
    name: z.string().min(1, "Name is required").max(200),
    password: z.string().min(6, "Password must be at least 6 characters"),
    username: z.string().min(3).max(50).optional(),
    role: userRoleEnum.nullable().optional(),
  accountType: userAccountTypeEnum.optional(),
    workspaceIds: workspaceIds.optional().default([]),
  });

export type UpdateUserAdminFormData = z.infer<typeof updateUserAdminSchema>;
export type CreateUserAdminFormData = z.infer<typeof createUserAdminSchema>;
