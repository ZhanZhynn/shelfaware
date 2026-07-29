import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import BusinessInsightPage from "@/components/Pages/BusinessInsightPage";
import { getProductsForUser } from "@/lib/server/home-data";
import { getOrdersForUser } from "@/lib/server/orders-data";
import { getCombinedInsightsForUser } from "@/lib/server/combined-orders-data";
import { getAdminDataScope } from "@/lib/admin/data-scope";

/**
 * Business Insights route — server component.
 * If user is not logged in, redirect to login. Otherwise fetch products, WMS orders,
 * and combined insights (WMS + Shopee orders, Shopee product stats, top Shopee products)
 * on the server and pass to BusinessInsightPage so the client can hydrate React Query
 * in one round-trip.
 */
export default async function BusinessInsightsRoute() {
  const user = await getSession();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "admin") {
    redirect(
      user.role === "client"
        ? "/client"
        : user.role === "supplier"
          ? "/supplier"
          : user.role === "sourcer"
            ? "/sourcing"
            : "/",
    );
  }
  const dataScope = await getAdminDataScope(user);
  const [initialProducts, initialOrders, initialCombinedInsights] =
    await Promise.all([
      getProductsForUser(user.id, dataScope),
      getOrdersForUser(user.id, dataScope),
      getCombinedInsightsForUser(user.id, dataScope),
    ]);
  return (
    <BusinessInsightPage
      initialProducts={initialProducts}
      initialOrders={initialOrders}
      initialCombinedInsights={initialCombinedInsights}
    />
  );
}
