import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { NOT_FOUND, requireAdmin, requireViewer } from "./lib/auth";
import { assertLoanRange, rangesOverlap, today } from "./lib/dates";

export type NotifyEvent =
  | "request.created"
  | "request.approved"
  | "request.declined"
  | "request.cancelled"
  | "request.returned";

/** Queue an n8n notification. Runs after the mutation commits, so a failed
 * webhook can never roll back (or block) the user's action. */
async function notify(ctx: MutationCtx, requestId: Id<"requests">, event: NotifyEvent) {
  await ctx.scheduler.runAfter(0, internal.notifications.send, { requestId, event, attempt: 1 });
}

async function activityFor(ctx: QueryCtx, requestId: Id<"requests">) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .order("desc")
    .take(5);
  return events.map((e) => ({ kind: e.kind, channel: e.channel ?? null, at: e.at }));
}

function isOverdue(r: Doc<"requests">, day: string) {
  return r.status === "approved" && r.endDate < day;
}

async function hasApprovedOverlap(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  startDate: string,
  endDate: string,
  excludeId?: Id<"requests">,
) {
  const approved = await ctx.db
    .query("requests")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .filter((q) => q.eq(q.field("status"), "approved"))
    .collect();
  return approved.some(
    (r) => r._id !== excludeId && rangesOverlap(r.startDate, r.endDate, startDate, endDate),
  );
}

export const create = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireViewer(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new ConvexError(NOT_FOUND);
    if (tool.ownerId === me._id) throw new ConvexError("You can't borrow your own tool.");
    assertLoanRange(args.startDate, args.endDate);

    const mineOpen = await ctx.db
      .query("requests")
      .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("borrowerId"), me._id),
          q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "approved")),
        ),
      )
      .first();
    if (mineOpen) throw new ConvexError("You already have an open request for this tool.");
    if (await hasApprovedOverlap(ctx, tool._id, args.startDate, args.endDate)) {
      throw new ConvexError("The tool is already lent out for some of those dates.");
    }

    const message = args.message?.trim().slice(0, 300) || undefined;
    const requestId = await ctx.db.insert("requests", {
      toolId: tool._id,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate: args.startDate,
      endDate: args.endDate,
      message,
      status: "pending",
    });
    await notify(ctx, requestId, "request.created");
    return requestId;
  },
});

/** Load a request the caller is allowed to act on in the given capacity. */
async function loadAs(ctx: MutationCtx, requestId: Id<"requests">, as: "owner" | "borrower" | "owner_or_admin") {
  const me = await requireViewer(ctx);
  const req = await ctx.db.get(requestId);
  const allowed =
    req &&
    ((as === "owner" && req.ownerId === me._id) ||
      (as === "borrower" && req.borrowerId === me._id) ||
      (as === "owner_or_admin" && (req.ownerId === me._id || me.role === "admin")));
  if (!allowed) throw new ConvexError(NOT_FOUND);
  return { me, req };
}

/** Only the tool's owner can approve or decline. Approving declines any other
 * pending requests that overlap, so the owner can't double-book by accident. */
export const decide = mutation({
  args: { requestId: v.id("requests"), approve: v.boolean() },
  handler: async (ctx, { requestId, approve }) => {
    const { req } = await loadAs(ctx, requestId, "owner");
    if (req.status !== "pending") throw new ConvexError("This request has already been answered.");

    if (!approve) {
      await ctx.db.patch(requestId, { status: "declined", decidedAt: Date.now() });
      await notify(ctx, requestId, "request.declined");
      return;
    }
    if (req.endDate < today()) throw new ConvexError("These dates have passed. Decline it instead.");
    if (await hasApprovedOverlap(ctx, req.toolId, req.startDate, req.endDate, requestId)) {
      throw new ConvexError("You've already approved a loan that overlaps these dates.");
    }
    await ctx.db.patch(requestId, { status: "approved", decidedAt: Date.now() });
    await notify(ctx, requestId, "request.approved");

    const clashing = await ctx.db
      .query("requests")
      .withIndex("by_tool", (q) => q.eq("toolId", req.toolId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    for (const other of clashing) {
      if (other._id !== requestId && rangesOverlap(other.startDate, other.endDate, req.startDate, req.endDate)) {
        await ctx.db.patch(other._id, {
          status: "declined",
          decidedAt: Date.now(),
          closedReason: "Dates taken by another loan",
        });
        await notify(ctx, other._id, "request.declined");
      }
    }
  },
});

export const cancel = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const { req } = await loadAs(ctx, requestId, "borrower");
    if (req.status !== "pending") throw new ConvexError("Only pending requests can be cancelled.");
    await ctx.db.patch(requestId, { status: "cancelled", decidedAt: Date.now() });
    await notify(ctx, requestId, "request.cancelled");
  },
});

/** The lender confirms they have the tool back (an admin can too, to resolve disputes). */
export const markReturned = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const { req } = await loadAs(ctx, requestId, "owner_or_admin");
    if (req.status !== "approved") throw new ConvexError("Only an active loan can be marked returned.");
    if (req.startDate > today()) throw new ConvexError("This loan hasn't started yet.");
    await ctx.db.patch(requestId, { status: "returned", returnedAt: Date.now() });
    await notify(ctx, requestId, "request.returned");
  },
});

/** Close every open request on a tool that is being removed. */
export async function closeOpenRequestsForTool(ctx: MutationCtx, toolId: Id<"tools">, reason: string) {
  const open = await ctx.db
    .query("requests")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .filter((q) => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "approved")))
    .collect();
  for (const r of open) {
    await ctx.db.patch(r._id, { status: "cancelled", decidedAt: Date.now(), closedReason: reason });
    await notify(ctx, r._id, "request.cancelled");
  }
}

async function shape(ctx: QueryCtx, r: Doc<"requests">, day: string, counterpartId: Id<"users">) {
  const other = await ctx.db.get(counterpartId);
  return {
    _id: r._id,
    toolName: r.toolName,
    startDate: r.startDate,
    endDate: r.endDate,
    message: r.message ?? null,
    status: r.status,
    overdue: isOverdue(r, day),
    closedReason: r.closedReason ?? null,
    counterpartName: other?.name ?? "Member",
    counterpartTrusted: other?.trustedLender ?? false,
    activity: await activityFor(ctx, r._id),
    createdAt: r._creationTime,
  };
}

/** "My requests": things I asked to borrow. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireViewer(ctx);
    const day = today();
    const rows = await ctx.db
      .query("requests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(100);
    return Promise.all(rows.map((r) => shape(ctx, r, day, r.ownerId)));
  },
});

/** "Incoming requests": requests for tools I own. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireViewer(ctx);
    const day = today();
    const rows = await ctx.db
      .query("requests")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .take(100);
    return Promise.all(rows.map((r) => shape(ctx, r, day, r.borrowerId)));
  },
});

/** Admin: every loan and request, with both parties. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const day = today();
    const rows = await ctx.db.query("requests").order("desc").take(300);
    return Promise.all(
      rows.map(async (r) => {
        const [owner, borrower] = await Promise.all([ctx.db.get(r.ownerId), ctx.db.get(r.borrowerId)]);
        return {
          _id: r._id,
          toolName: r.toolName,
          ownerName: owner?.name ?? "Member",
          borrowerName: borrower?.name ?? "Member",
          startDate: r.startDate,
          endDate: r.endDate,
          status: r.status,
          overdue: isOverdue(r, day),
          activity: await activityFor(ctx, r._id),
        };
      }),
    );
  },
});
