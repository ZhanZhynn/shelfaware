/** List fixture identities only, in the explicitly selected local demo database. */
import { reportDemoFailure, withDemoDatabase } from "./demo-policy";

withDemoDatabase(async (prisma) => {
  const users = await prisma.user.findMany({
    where: { email: { in: ["test@user.com", "test@admin.com", "test@retailer.com", "test@client.com", "test@supplier.com"] } },
    orderBy: { createdAt: "asc" },
    select: { email: true, role: true, status: true },
  });
  for (const user of users) console.log(`${user.email}: ${user.role} (${user.status})`);
  console.log(`Local demo identities: ${users.length}`);
}).catch(reportDemoFailure);
