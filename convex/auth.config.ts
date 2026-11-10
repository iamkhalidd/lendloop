import type { AuthConfig } from "convex/server";

// Convex verifies Clerk-issued JWTs itself; set CLERK_JWT_ISSUER_DOMAIN in the
// Convex dashboard (Settings -> Environment Variables) to your Clerk Frontend API URL.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
