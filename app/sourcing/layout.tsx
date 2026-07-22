import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { hasSourcingAccess } from "@/lib/sourcing/portal";
import SourcingHeader from "@/components/sourcing/SourcingHeader";

export default async function SourcingLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect("/login/sourcing?next=/sourcing");
  if (!await hasSourcingAccess(user)) redirect("/login/sourcing?error=no_sourcing_access");
  return user.role === "admin" ? children : <><SourcingHeader userName={user.name || user.email} />{children}</>;
}
