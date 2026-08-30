import "server-only";

import bcrypt from "bcryptjs";
import { z } from "zod";

/**
 * The one place login credential rules live.
 *
 * Setup → Teachers creates a Teacher and their login together; User/Roles
 * creates ADMIN/STAFF logins and resets anyone's password. Both must agree on
 * what a username may contain, how short a password may be, and how it is
 * hashed — three rules that would silently drift if each screen kept its own.
 */

/** bcrypt cost factor. 10 is what every existing hash in the database used. */
const COST = 10;

export const usernameField = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(50)
  .regex(/^[a-zA-Z0-9._-]+$/, "Username may use letters, numbers, . _ - only.");

export const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200);

/** Plaintext never leaves this function — it is not stored, logged, or echoed. */
export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
