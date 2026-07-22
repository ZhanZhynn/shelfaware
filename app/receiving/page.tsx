import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import ReceivingPage from "@/components/receiving/ReceivingPage";

export default async function ReceivingRoute() {
  const user = await getSession();
  if (!user) redirect("/login");
  // Fine-grained workspace authorization is enforced by receiving APIs because
  // the page can operate across a user's permitted workspaces.
  if (user.role !== "admin") {
    const { prisma } = await import("@/prisma/client");
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: user.id, role: { in: ["admin", "warehouse"] } } });
    if (!membership) redirect("/");
  }
  return <ReceivingPage />;
}
