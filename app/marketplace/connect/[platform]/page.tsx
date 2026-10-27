import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { isOAuthPlatform, validShopifyDomain } from "@/lib/auth/marketplace-connect";
import { MarketplaceConnect } from "@/components/marketplace/MarketplaceConnect";

export default async function ConnectPage({ params, searchParams }: { params: Promise<{ platform: string }>; searchParams: Promise<{ shop?: string }> }) {
  const { platform } = await params;
  if (!isOAuthPlatform(platform)) notFound();
  const { shop } = await searchParams;
  const initialShop = platform === "shopify" && typeof shop === "string" && validShopifyDomain(shop) ? shop : "";
  const path = `/marketplace/connect/${platform}${initialShop ? `?shop=${encodeURIComponent(initialShop)}` : ""}`;
  const user = await getSession();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(path)}`);
  if (user.role !== "admin" || (user.status ?? "approved") !== "approved") redirect("/");
  return <MarketplaceConnect platform={platform} identity={user.email} initialShop={initialShop} />;
}
