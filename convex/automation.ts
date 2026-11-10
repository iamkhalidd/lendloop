import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { daysBetween, isValidDate, today } from "./lib/dates";

/** Overdue loans for the daily n8n reminder run. Only the fields needed to
 * write one reminder are returned. Loans already reminded today are skipped,
 * so re-running the workflow the same day sends nothing twice. */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const day = today();
    const loans = await ctx.db
      .query("requests")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", day))
      .take(500);
    const out = [];
    for (const loan of loans) {
      const already = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("key", `reminder_sent:${loan._id}:${day}`))
        .first();
      if (already) continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower?.email) continue;
      out.push({
        loanId: loan._id,
        reminderDate: day,
        borrowerName: borrower.name,
        borrowerEmail: borrower.email,
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, day),
      });
    }
    return out;
  },
});

const MAX_DETAIL = 500;

/** Write-back from n8n. `key` makes it idempotent: Convex mutations are
 * serializable transactions, so check-then-insert can't race into a duplicate. */
export const recordFromN8n = internalMutation({
  args: {
    kind: v.union(
      v.literal("notification_sent"),
      v.literal("notification_failed"),
      v.literal("reminder_sent"),
      v.literal("reminder_failed"),
      v.literal("workflow_error"),
    ),
    key: v.string(),
    requestId: v.optional(v.string()),
    channel: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const requestId = args.requestId ? ctx.db.normalizeId("requests", args.requestId) : null;
    if (args.requestId && (!requestId || !(await ctx.db.get(requestId)))) {
      return { status: 404 as const, body: { error: "unknown request" } };
    }
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) return { status: 200 as const, body: { ok: true, duplicate: true } };

    await ctx.db.insert("automationEvents", {
      key: args.key,
      requestId: requestId ?? undefined,
      kind: args.kind,
      channel: args.channel?.slice(0, 40),
      detail: args.detail?.slice(0, MAX_DETAIL),
      at: Date.now(),
    });
    return { status: 200 as const, body: { ok: true, duplicate: false } };
  },
});

export function validReminderDate(value: unknown): value is string {
  return typeof value === "string" && isValidDate(value);
}

/** Admin view of failures so nothing fails silently. */
export const recentFailures = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const events = await ctx.db.query("automationEvents").order("desc").take(200);
    return events
      .filter((e) => e.kind.endsWith("_failed") || e.kind === "workflow_error")
      .slice(0, 50)
      .map((e) => ({ _id: e._id, kind: e.kind, detail: e.detail ?? null, at: e.at }));
  },
});
