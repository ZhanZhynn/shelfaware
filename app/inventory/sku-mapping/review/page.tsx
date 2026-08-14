import { redirect } from "next/navigation";

export default function InventoryLinkingReviewRedirect() {
  redirect("/admin/inventory/sku-mapping/review");
}
