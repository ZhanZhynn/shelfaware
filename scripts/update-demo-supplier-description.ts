/** Refresh a fixture supplier's description in the explicit local demo database. */
import { reportDemoFailure, withDemoDatabase } from "./demo-policy";

withDemoDatabase(async (prisma) => {
  const user = await prisma.user.findUnique({ where: { email: "test@supplier.com" }, select: { id: true } });
  if (!user) throw new Error("No local supplier fixture exists; create the demo accounts first");
  const supplier = await prisma.supplier.findFirst({ where: { name: "Demo Supplier", userId: user.id }, select: { id: true } });
  if (!supplier) throw new Error("No supplier belonging to the local fixture exists");
  await prisma.supplier.update({
    where: { id: supplier.id },
    data: {
      description: "Local demo supplier for inventory and ordering fixtures.",
      notes: "Use only with the local demo accounts and fixture data.",
      updatedAt: new Date(),
    },
  });
  console.log("Updated the local demo supplier description.");
}).catch(reportDemoFailure);
