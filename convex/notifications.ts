import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { signRequest, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/hmac";
import { automationKind } from "./schema";

const MAX_ATTEMPTS = 5;
const eventValidator = v.union(
  v.literal("request.created"),
  v.literal("request.approved"),
  v.literal("request.declined"),
  v.literal("request.cancelled"),
  v.literal("request.returned"),
);

/** Builds the smallest payload n8n needs to notify one person.
 * Owner hears about new/cancelled requests; borrower hears about decisions. */
export const payload = internalQuery({
  args: { requestId: v.id("requests"), event: eventValidator },
  handler: async (ctx, { requestId, event }) => {
    const req = await ctx.db.get(requestId);
    if (!req) return null;
    const toOwner = event === "request.created" || event === "request.cancelled";
    const recipient = await ctx.db.get(toOwner ? req.ownerId : req.borrowerId);
    const other = await ctx.db.get(toOwner ? req.borrowerId : req.ownerId);
    if (!recipient) return null;
    return {
      // Unique per request + transition, so n8n's write-back is idempotent.
      eventId: `${requestId}:${event}`,
      event,
      requestId,
      recipient: { name: recipient.name, email: recipient.email },
      otherPartyName: other?.name ?? "A member",
      toolName: req.toolName,
      startDate: req.startDate,
      endDate: req.endDate,
      ...(req.closedReason ? { reason: req.closedReason } : {}),
    };
  },
});

/** POST the signed payload to n8n, retrying with exponential backoff.
 * After the last attempt the failure is recorded so it shows in the app. */
export const send = internalAction({
  args: { requestId: v.id("requests"), event: eventValidator, attempt: v.number() },
  // Explicit return type: this action calls functions in its own module, and
  // without it the generated `api` type would be circular.
  handler: async (ctx, { requestId, event, attempt }): Promise<void> => {
    const url = process.env.N8N_NOTIFY_WEBHOOK_URL;
    const secret = process.env.CONVEX_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.record, {
        key: `notify-failed:${requestId}:${event}`,
        requestId,
        kind: "notification_failed",
        detail: "n8n webhook not configured",
      });
      return;
    }
    const data = await ctx.runQuery(internal.notifications.payload, { requestId, event });
    if (!data) return;

    const body = JSON.stringify(data);
    const path = new URL(url).pathname;
    const { timestamp, signature } = await signRequest(secret, "POST", path, body);

    let error: string | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) error = `n8n responded ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : "network error";
    }
    if (!error) return; // n8n confirms delivery itself via /n8n/notification-status

    if (attempt < MAX_ATTEMPTS) {
      const delayMs = 2 ** attempt * 5_000; // 10s, 20s, 40s, 80s
      await ctx.scheduler.runAfter(delayMs, internal.notifications.send, {
        requestId,
        event,
        attempt: attempt + 1,
      });
    } else {
      await ctx.runMutation(internal.notifications.record, {
        key: `notify-failed:${requestId}:${event}`,
        requestId,
        kind: "notification_failed",
        detail: `${error} after ${MAX_ATTEMPTS} attempts`,
      });
    }
  },
});

/** Idempotent insert into the automation ledger: the same key is stored once. */
export const record = internalMutation({
  args: {
    key: v.string(),
    requestId: v.optional(v.id("requests")),
    kind: automationKind,
    channel: v.optional(v.string()),
    detail: v.optional(v.string()),
    at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) return { duplicate: true as const, id: existing._id };
    const id = await ctx.db.insert("automationEvents", {
      key: args.key,
      requestId: args.requestId,
      kind: args.kind,
      channel: args.channel,
      detail: args.detail?.slice(0, 500),
      at: args.at ?? Date.now(),
    });
    return { duplicate: false as const, id };
  },
});
