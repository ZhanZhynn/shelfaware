import { isIP } from "node:net";

/** Opt in only behind an ingress that overwrites the selected header. */
export function trustedClientIdentifier(headers: Headers): string {
  const provider = process.env.TRUSTED_PROXY_PROVIDER ?? (process.env.VERCEL === "1" ? "vercel" : "none");
  const header = provider === "cloudflare" ? "cf-connecting-ip" : provider === "vercel" && process.env.VERCEL === "1" ? "x-forwarded-for" : null;
  const value = header ? headers.get(header)?.trim() : undefined;
  // Vercel overwrites x-forwarded-for. Outside that contract it is untrusted.
  return value && value.length <= 45 && isIP(value) ? `ip:${value.toLowerCase()}` : "ip:unverified";
}
