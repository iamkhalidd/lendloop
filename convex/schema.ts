import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;

export const CONDITIONS = ["new", "good", "fair", "worn"] as const;

export const category = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const condition = v.union(...CONDITIONS.map((c) => v.literal(c)));

export const requestStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const automationKind = v.union(
  v.literal("notification_sent"),
  v.literal("notification_failed"),
  v.literal("reminder_sent"),
  v.literal("reminder_failed"),
  v.literal("workflow_error"),
);

export default defineSchema({
  users: defineTable({
    // Clerk's stable identifier for the signed-in user (issuer + subject).
    tokenIdentifier: v.string(),
    // Only what the app needs: a display name for lenders/borrowers and an
    // email address so n8n can send notifications. Nothing else from Clerk is stored.
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("user"), v.literal("admin")),
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  // A borrow request. Once approved it is a loan; "returned" closes it.
  requests: defineTable({
    toolId: v.id("tools"),
    // Snapshot so history still reads well if the listing is later removed.
    toolName: v.string(),
    // Copied from the tool at request time so authorization checks and
    // "incoming requests" never need to trust the client.
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD, inclusive
    message: v.optional(v.string()),
    status: requestStatus,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    // Set when the tool listing was removed while this request was open.
    closedReason: v.optional(v.string()),
  })
    .index("by_tool", ["toolId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_status_end", ["status", "endDate"]),

  // Everything n8n did (or failed to do) for a request. Doubles as the
  // idempotency ledger for write-backs: `key` is unique per logical event.
  automationEvents: defineTable({
    key: v.string(),
    requestId: v.optional(v.id("requests")),
    kind: automationKind,
    channel: v.optional(v.string()),
    detail: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_request", ["requestId"]),
});
