/**
 * Change one existing fixture's identity in the local demo database.
 * Requires explicit --to <role>, DEMO_DATABASE_URL and DEMO_USER_PASSWORD.
 * Admin is an explicit local fixture choice, never a default or production action.
 */
import bcrypt from "bcryptjs";
import { assertDemoTarget, parseDemoRole, requireDemoPassword, reportDemoFailure, withDemoDatabase } from "./demo-policy";

const targets = {
  admin: { email: "test@admin.com", name: "Test Admin", role: "admin" },
  retailer: { email: "test@retailer.com", name: "Test Retailer", role: "retailer" },
  client: { email: "test@client.com", name: "Client/Customer", role: "client" },
  supplier: { email: "test@supplier.com", name: "Test Supplier", role: "supplier" },
};
const demoEmails = ["test@user.com", ...Object.values(targets).map(({ email }) => email)];

async function main() {
  assertDemoTarget(process.env);
  const target = targets[parseDemoRole(process.argv.slice(2))];
  const password = requireDemoPassword(process.env, "DEMO_USER_PASSWORD");
  await withDemoDatabase(async (prisma) => {
    const existing = await prisma.user.findFirst({ where: { email: { in: demoEmails } }, select: { id: true } });
    if (!existing) throw new Error("No local demo user exists; create the client/supplier fixtures first");
    await prisma.user.update({ where: { id: existing.id }, data: { ...target, password: await bcrypt.hash(password, 10), updatedAt: new Date() } });
    if (target.role === "supplier") {
      const supplier = await prisma.supplier.findFirst({ where: { name: "Demo Supplier", userId: existing.id }, select: { id: true } });
      if (!supplier) await prisma.supplier.create({ data: { name: "Demo Supplier", userId: existing.id, status: true, createdBy: existing.id, updatedBy: existing.id, updatedAt: new Date() } });
    }
    console.log(`Updated local fixture: ${target.email} (${target.role}). Password was supplied privately and is not printed.`);
  });
}

main().catch(reportDemoFailure);
