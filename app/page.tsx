import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { hasSourcingAccess } from "@/lib/sourcing/portal";
import HomePage from "@/components/Pages/HomePage";
import {
  getProductsForUser,
  getCategoriesForUser,
  getSuppliersForUser,
} from "@/lib/server/home-data";

/**
 * Home route — server component.
 * No route-level Suspense: root layout uses force-dynamic so useSearchParams works
 * without a fallback skeleton. SSR fetch here; client HomePage handles OAuth + RQ hydrate.
 */
export default async function HomeRoute({
  searchParams,
}: {
  searchParams: Promise<{ oauth_success?: string }>;
}) {
  const user = await getSession();
  if (!user) {
    redirect("/login");
  }
  if (user.role === "client") {
    redirect("/client");
  }
  if (user.role === "supplier") {
    redirect("/supplier");
  }
  if (user.role !== "admin" && (await hasSourcingAccess(user))) {
    redirect("/sourcing");
  }

  const params = await searchParams;
  const initialOAuthSuccess = params.oauth_success === "true";

  const [products, categories, suppliers] = await Promise.all([
    getProductsForUser(user.id),
    getCategoriesForUser(user.id),
    getSuppliersForUser(user.id),
  ]);

  return (
    <HomePage
      initialProducts={products}
      initialCategories={categories}
      initialSuppliers={suppliers}
      initialOAuthSuccess={initialOAuthSuccess}
    />
  );
}
