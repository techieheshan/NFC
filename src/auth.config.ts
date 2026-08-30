import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the Auth.js config.
 *
 * `middleware.ts` instantiates NextAuth with THIS object only, so it must never
 * pull in Prisma or bcrypt (neither runs on the edge runtime). The Credentials
 * provider — which does both — is added in `src/auth.ts`, which only ever runs
 * in Node. Session is JWT, so the middleware can authorize by reading the token
 * alone, with no database round-trip.
 */
export const authConfig = {
  /**
   * Self-hosted: the app is reached by LAN IP, hostname, or localhost depending
   * on the terminal, so Auth.js cannot infer its own origin. Without this it
   * refuses every request with UntrustedHost in production. Set AUTH_URL
   * instead if the deployment ever gets one fixed public origin.
   */
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    /**
     * Runs in middleware. Returning false sends the visitor to `pages.signIn`.
     *
     * This is a COARSE gate: on the edge there is no database, so it can only
     * ask "is there a decodable token", not "is that token still valid". The
     * authoritative check — account deactivated, session revoked — lives in the
     * Node `jwt` callback in src/auth.ts.
     *
     * /login is therefore always allowed through, never redirected away from.
     * Bouncing a token-holder to "/" here caused an infinite loop the moment
     * revocation landed: the edge saw a token and sent them to "/", the app
     * layout asked the database, found the session revoked, and sent them back.
     * The "already signed in, skip the form" redirect now lives on the login
     * page itself, which can actually tell.
     */
    authorized({ auth, request: { nextUrl } }) {
      if (nextUrl.pathname === "/login") return true;
      return Boolean(auth?.user);
    },

    // Copy identity + role onto the token at sign-in, then off it on every read.
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.username = user.username;
        token.role = user.role;
      }
      return token;
    },

    session({ session, token }) {
      session.user.id = token.userId;
      session.user.username = token.username;
      session.user.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
