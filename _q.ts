import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }) });
db.student.findMany({ where: { name: { startsWith: "PATCH " } }, select: { id: true, name: true, cardNumber: true, cardUid: true, phone: true }, orderBy: { id: "asc" } })
  .then(r => r.forEach(s => console.log(`STU ${s.id} ${s.name} number=${s.cardNumber} uid=${s.cardUid}`)))
  .finally(() => db.$disconnect());
