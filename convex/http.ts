import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { validReminderDate } from "./automation";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyRequest } from "./lib/hmac";

/**
 * Endpoints n8n calls. Every one verifies an HMAC signature made with
 * N8N_TO_CONVEX_SECRET (a different secret from the one Convex uses to sign
 * outgoing webhooks, so leaking one direction doesn't compromise the other).
 */

const http = httpRouter();
const MAX_BODY_BYTES = 16 * 1024;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Reads the raw body, verifies the signature over exactly those bytes, then parses. */
async function verified(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { ok: false, res: json(413, { error: "payload too large" }) };
  const url = new URL(request.url);
  const result = await verifyRequest(
    process.env.N8N_TO_CONVEX_SECRET,
    request.method,
    url.pathname,
    raw,
    request.headers.get(TIMESTAMP_HEADER),
    request.headers.get(SIGNATURE_HEADER),
  );
  // One generic answer for every failure so callers learn nothing about why.
  if (!result.ok) return { ok: false, res: json(401, { error: "unauthorized" }) };
  if (!raw) return { ok: true, body: null };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, res: json(400, { error: "invalid json" }) };
  }
}

const str = (v: unknown, max = 200) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

async function record(
  ctx: ActionCtx,
  args: {
    kind: "notification_sent" | "notification_failed" | "reminder_sent" | "reminder_failed" | "workflow_error";
    key: string;
    requestId?: string;
    channel?: string;
    detail?: string;
  },
) {
  const out = await ctx.runMutation(internal.automation.recordFromN8n, args);
  return json(out.status, out.body);
}

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const check = await verified(request);
    if (!check.ok) return check.res;
    const loans = await ctx.runQuery(internal.automation.overdueLoans, {});
    return json(200, { loans });
  }),
});

http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const check = await verified(request);
    if (!check.ok) return check.res;
    const b = (check.body ?? {}) as Record<string, unknown>;
    const loanId = str(b.loanId, 64);
    const status = b.status === "sent" || b.status === "failed" ? b.status : null;
    if (!loanId || !status || !validReminderDate(b.reminderDate)) {
      return json(400, { error: "loanId, status (sent|failed) and reminderDate are required" });
    }
    const kind = status === "sent" ? "reminder_sent" : "reminder_failed";
    return record(ctx, {
      kind,
      // One reminder per loan per day; retries of the same write-back are no-ops.
      key: `${kind}:${loanId}:${b.reminderDate}`,
      requestId: loanId,
      channel: str(b.channel, 40) ?? undefined,
      detail: str(b.detail, 500) ?? undefined,
    });
  }),
});

http.route({
  path: "/n8n/notification-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const check = await verified(request);
    if (!check.ok) return check.res;
    const b = (check.body ?? {}) as Record<string, unknown>;
    const eventId = str(b.eventId, 120);
    const requestId = eventId?.split(":")[0];
    const status = b.status === "sent" || b.status === "failed" ? b.status : null;
    if (!eventId || !requestId || !status) {
      return json(400, { error: "eventId and status (sent|failed) are required" });
    }
    const kind = status === "sent" ? "notification_sent" : "notification_failed";
    return record(ctx, {
      kind,
      key: `${kind}:${eventId}`,
      requestId,
      channel: str(b.channel, 40) ?? undefined,
      detail: str(b.detail, 500) ?? undefined,
    });
  }),
});

/** Called by the n8n error workflow so failed executions show up in the admin view. */
http.route({
  path: "/n8n/workflow-error",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const check = await verified(request);
    if (!check.ok) return check.res;
    const b = (check.body ?? {}) as Record<string, unknown>;
    const executionId = str(b.executionId, 64);
    if (!executionId) return json(400, { error: "executionId is required" });
    const workflow = str(b.workflowName, 100) ?? "unknown workflow";
    const message = str(b.message, 400) ?? "no message";
    return record(ctx, {
      kind: "workflow_error",
      key: `workflow_error:${executionId}`,
      detail: `${workflow}: ${message}`,
    });
  }),
});

export default http;
