/**
 * Unique username generation for auth flows (OAuth, register).
 * Mirrors register route collision handling via usernameExists.
 */

import { usernameExists } from "@/prisma/user-admin";

/** Normalize a base string into a lowercase username-safe token */
export function normalizeUsernameBase(base: string): string {
  const cleaned = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 32);
  return cleaned.length > 0 ? cleaned : "user";
}

/**
 * Return a username not yet taken. Appends numeric suffix on collision.
 */
export async function generateUniqueUsername(base: string): Promise<string> {
  const normalized = normalizeUsernameBase(base);
  let candidate = normalized;
  let counter = 1;

  while (await usernameExists(candidate)) {
    candidate = `${normalized}${counter}`;
    counter += 1;
  }

  return candidate;
}
