import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { NOT_FOUND, requireViewer } from "./lib/auth";
import { today } from "./lib/dates";
import { category, condition } from "./schema";
import { closeOpenRequestsForTool } from "./requests";

const LIST_LIMIT = 200;

function cleanText(value: string, field: string, max: number, min = 1) {
  const trimmed = value.trim();
  if (trimmed.length < min) throw new ConvexError(`${field} is required.`);
  if (trimmed.length > max) throw new ConvexError(`${field} must be at most ${max} characters.`);
  return trimmed;
}

type Availability =
  | { state: "available" }
  | { state: "on_loan"; until: string }
  | { state: "overdue"; since: string };

/** A tool is unavailable while an approved, unreturned loan has started. */
async function availabilityOf(ctx: QueryCtx, toolId: Id<"tools">, day: string): Promise<Availability> {
  const loans = await ctx.db
    .query("requests")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .filter((q) => q.eq(q.field("status"), "approved"))
    .collect();
  const active = loans.find((l) => l.startDate <= day);
  if (!active) return { state: "available" };
  return active.endDate < day
    ? { state: "overdue", since: active.endDate }
    : { state: "on_loan", until: active.endDate };
}

/** Public, signed-out page. Returns only name and category of tools that can
 * be borrowed right now: no owner, condition, description or ids of people. */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const day = today();
    const tools = await ctx.db.query("tools").order("desc").take(LIST_LIMIT);
    const out: { _id: Id<"tools">; name: string; category: Doc<"tools">["category"] }[] = [];
    for (const t of tools) {
      if ((await availabilityOf(ctx, t._id, day)).state === "available") {
        out.push({ _id: t._id, name: t.name, category: t.category });
      }
    }
    return out;
  },
});

/** Signed-in catalogue with availability, filterable by category. Owners are
 * shown by first name only, with their Trusted Lender badge. */
export const list = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const me = await requireViewer(ctx);
    const day = today();
    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .order("desc")
          .take(LIST_LIMIT)
      : await ctx.db.query("tools").order("desc").take(LIST_LIMIT);

    return Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        const myOpen = await ctx.db
          .query("requests")
          .withIndex("by_tool", (q) => q.eq("toolId", t._id))
          .filter((q) =>
            q.and(
              q.eq(q.field("borrowerId"), me._id),
              q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "approved")),
            ),
          )
          .first();
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          ownerName: owner?.name ?? "Member",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: t.ownerId === me._id,
          myOpenRequest: myOpen ? { status: myOpen.status, startDate: myOpen.startDate, endDate: myOpen.endDate } : null,
          availability: await availabilityOf(ctx, t._id, day),
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireViewer(ctx);
    const day = today();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return Promise.all(
      tools.map(async (t) => {
        const pending = await ctx.db
          .query("requests")
          .withIndex("by_tool", (q) => q.eq("toolId", t._id))
          .filter((q) => q.eq(q.field("status"), "pending"))
          .collect();
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          pendingRequests: pending.length,
          availability: await availabilityOf(ctx, t._id, day),
        };
      }),
    );
  },
});

const toolFields = {
  name: v.string(),
  category,
  condition,
  description: v.string(),
};

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const me = await requireViewer(ctx);
    return await ctx.db.insert("tools", {
      ownerId: me._id, // always the caller, never taken from the client
      name: cleanText(args.name, "Name", 80),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", 500),
    });
  },
});

async function loadOwnTool(ctx: MutationCtx, toolId: Id<"tools">) {
  const me = await requireViewer(ctx);
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.ownerId !== me._id) throw new ConvexError(NOT_FOUND);
  return { me, tool };
}

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    await loadOwnTool(ctx, toolId);
    await ctx.db.patch(toolId, {
      name: cleanText(args.name, "Name", 80),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", 500),
    });
  },
});

/** Owners can remove their own listing; admins can remove any listing.
 * Open requests on it are closed so nobody is left waiting on a ghost tool. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    const allowed = tool && (tool.ownerId === me._id || me.role === "admin");
    if (!allowed) throw new ConvexError(NOT_FOUND);
    const reason = tool.ownerId === me._id ? "Listing removed by its owner" : "Listing removed by an admin";
    await closeOpenRequestsForTool(ctx, toolId, reason);
    await ctx.db.delete(toolId);
  },
});
