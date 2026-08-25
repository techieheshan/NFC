import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 reads connection URLs from here rather than from schema.prisma.
 *
 * `datasource.url` is used ONLY by the CLI (migrate / studio / db seed), so it
 * points at Neon's DIRECT (non-pooled) endpoint — PgBouncer cannot run DDL in
 * the way Migrate needs. The application itself never uses this value; it
 * connects through the pooled DATABASE_URL via the driver adapter in
 * src/lib/db.ts.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DIRECT_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
