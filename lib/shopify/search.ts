/** Shopify search grammar requires quoting timestamps containing colons. */
export function shopifyDateQuery(field: "created_at" | "updated_at", from: string, to?: string) {
  const filters = [`${field}:>=${JSON.stringify(new Date(from).toISOString())}`];
  if (to) filters.push(`${field}:<=${JSON.stringify(new Date(to).toISOString())}`);
  return filters.join(" ");
}
