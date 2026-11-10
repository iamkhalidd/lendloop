import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getViewer, NOT_FOUND, requireAdmin } from "./lib/auth";

/** Called by the client right after sign-in. Creates or refreshes the
 * user's row from the verified Clerk token, never from client-supplied data. */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to continue.");

    const name = (identity.givenName ?? identity.name ?? identity.nickname ?? "Member").slice(0, 60);
    const email = identity.email ?? "";

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }
    // New accounts are always plain users. Admins are promoted out of band
    // (see `setRole`), so no request from the browser can grant admin.
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: "user",
      trustedLender: false,
    });
  },
});

/** What the UI needs to know about the signed-in user. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const me = await getViewer(ctx);
    if (!me) return null;
    return { _id: me._id, name: me.name, role: me.role, trustedLender: me.trustedLender };
  },
});

export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(500);
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError(NOT_FOUND);
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/** Internal only: run from the Convex dashboard or CLI to promote an admin:
 *   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
 * Internal functions cannot be called from the browser. */
export const setRole = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("user"), v.literal("admin")) },
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new ConvexError("No user with that email has signed in yet.");
    await ctx.db.patch(user._id, { role });
    return user._id;
  },
});
