/**
 * Import FIRST in a test that must not touch any database.
 *
 * `@/lib/db` builds its client the moment it is imported and throws without a
 * `DATABASE_URL`. This points it at a hostname that cannot resolve (`.invalid`
 * is reserved and never exists), whatever is exported in the shell — so even if
 * a "pure" test were to reach for a query by mistake, it fails to connect
 * instead of reading or writing a real database.
 */
process.env.DATABASE_URL = "postgresql://nobody:nobody@db-free.invalid:5432/none";
