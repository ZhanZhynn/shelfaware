/**
 * Provision client/supplier fixtures in an explicit local demo database.
 * Requires NODE_ENV=development|test, DEMO_DATABASE_URL and securely supplied
 * DEMO_CLIENT_PASSWORD / DEMO_SUPPLIER_PASSWORD. Credentials are never printed.
 */
import bcrypt from "bcryptjs";
import { assertDemoTarget, requireDemoPassword, reportDemoFailure, withDemoDatabase } from "./demo-policy";

async function main() {
  assertDemoTarget(process.env);
  const users = [
    { email: "test@client.com", name: "Test Client", username: "testclient", role: "client", googleId: "demo-client", password: requireDemoPassword(process.env, "DEMO_CLIENT_PASSWORD") },
    { email: "test@supplier.com", name: "Test Supplier", username: "testsupplier", role: "supplier", googleId: "demo-supplier", password: requireDemoPassword(process.env, "DEMO_SUPPLIER_PASSWORD") },
  ];

  await withDemoDatabase(async (prisma) => {
    for (const { password, ...user } of users) {
      const existing = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
      if (existing) { console.log(`Fixture already exists: ${user.email}`); continue; }
      await prisma.user.create({ data: { ...user, password: await bcrypt.hash(password, 10), status: "approved", createdAt: new Date() } });
      console.log(`Created ${user.role} fixture: ${user.email}`);
    }

    const supplierUser = await prisma.user.findUnique({ where: { email: "test@supplier.com" }, select: { id: true } });
    if (supplierUser) {
      const supplier = await prisma.supplier.findFirst({ where: { name: "Demo Supplier", userId: supplierUser.id }, select: { id: true } });
      if (!supplier) await prisma.supplier.create({ data: { name: "Demo Supplier", userId: supplierUser.id, status: true, createdBy: supplierUser.id, updatedBy: supplierUser.id, updatedAt: new Date() } });
    }
    console.log("Demo fixtures ready. Use the passwords supplied through your private environment.");
  });
}

main().catch(reportDemoFailure);
