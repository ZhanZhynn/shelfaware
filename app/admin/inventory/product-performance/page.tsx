import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ProductPerformanceDashboard from "@/components/product-performance/ProductPerformanceDashboard";
export default async function ProductPerformancePage() { if (!await getSession()) redirect("/login"); return <ProductPerformanceDashboard />; }
