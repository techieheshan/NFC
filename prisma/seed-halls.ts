/**
 * The institute's eleven rooms.
 *
 * Seeded, not hardcoded: they are reference data from here on — renameable,
 * deactivatable, and extendable from /admin/halls. Re-running this is safe; it
 * only fills in a hall that is missing by name, and never overwrites an icon
 * someone has since changed.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const HALLS = [
  { name: "Rhythm Devin", icon: "music" },
  { name: "Forget Me Not", icon: "flower-2" },
  { name: "Avocado", icon: "salad" },
  { name: "Lumos", icon: "lightbulb" },
  { name: "Daffodil", icon: "flower" },
  { name: "Moonlight", icon: "moon" },
  { name: "Sunset", icon: "sunset" },
  { name: "Blue Sky", icon: "cloud" },
  { name: "Picasso", icon: "palette" },
  { name: "Rest Area", icon: "armchair" },
  { name: "Tesla", icon: "zap" },
];

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let added = 0;
  for (const hall of HALLS) {
    const existing = await db.hall.findUnique({ where: { name: hall.name } });
    if (existing) continue;
    await db.hall.create({ data: hall });
    added++;
  }
  console.log(`Halls: ${added} added, ${HALLS.length - added} already present.`);
  await db.$disconnect();
}

main();
