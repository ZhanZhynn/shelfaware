export function safeSourcingDestination(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/sourcing";
  return value.startsWith("/admin/sourcing") || value.startsWith("/sourcing") ? value : "/sourcing";
}

export function sourcingDestination(user: { role: string | null }) {
  return user.role === "admin" ? "/admin/sourcing" : "/sourcing";
}

export function canonicalAdminSourcingPath(pathname: string, search = "") {
  return `${pathname.replace(/^\/sourcing/, "/admin/sourcing")}${search}`;
}
