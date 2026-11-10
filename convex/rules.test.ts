/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { signRequest } from "./lib/hmac";
import { today } from "./lib/dates";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-n8n-to-convex-secret";

const OWNER = { subject: "owner", issuer: "https://clerk.test", name: "Olu", givenName: "Olu", email: "olu@example.com" };
const BORROWER = { subject: "borrower", issuer: "https://clerk.test", name: "Bisi", givenName: "Bisi", email: "bisi@example.com" };
const INTRUDER = { subject: "intruder", issuer: "https://clerk.test", name: "Ivo", givenName: "Ivo", email: "ivo@example.com" };
const ADMIN = { subject: "admin", issuer: "https://clerk.test", name: "Ada", givenName: "Ada", email: "ada@example.com" };

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(OWNER);
  const borrower = t.withIdentity(BORROWER);
  const intruder = t.withIdentity(INTRUDER);
  const admin = t.withIdentity(ADMIN);
  for (const who of [owner, borrower, intruder, admin]) await who.mutation(api.users.store, {});
  await t.run(async (ctx) => {
    const a = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", ADMIN.email)).unique();
    await ctx.db.patch(a!._id, { role: "admin" });
  });
  const toolId = await owner.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18V with two batteries.",
  });
  return { t, owner, borrower, intruder, admin, toolId };
}

beforeEach(() => {
  vi.stubEnv("N8N_TO_CONVEX_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public page", () => {
  test("signed-out list exposes only name and category", async () => {
    const { t } = await setup();
    const rows = await t.query(api.tools.listPublic, {});
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["_id", "category", "name"]);
  });

  test("signed-out users can't read the full catalogue", async () => {
    const { t } = await setup();
    await expect(t.query(api.tools.list, {})).rejects.toThrow(/Sign in/);
  });
});

describe("listings", () => {
  test("only the owner can edit a listing", async () => {
    const { intruder, toolId } = await setup();
    await expect(
      intruder.mutation(api.tools.update, {
        toolId,
        name: "Mine now",
        category: "garden",
        condition: "worn",
        description: "x",
      }),
    ).rejects.toThrow(/Not found/);
  });

  test("a user can't remove someone else's listing, an admin can", async () => {
    const { t, intruder, admin, toolId } = await setup();
    await expect(intruder.mutation(api.tools.remove, { toolId })).rejects.toThrow(/Not found/);
    await admin.mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(0);
  });
});

describe("borrowing", () => {
  test("you can't borrow your own tool", async () => {
    const { owner, toolId } = await setup();
    const d = today();
    await expect(owner.mutation(api.requests.create, { toolId, startDate: d, endDate: d })).rejects.toThrow(
      /your own tool/,
    );
  });

  test("only the tool's owner can approve; the borrower and strangers can't", async () => {
    const { owner, borrower, intruder, toolId } = await setup();
    const d = today();
    const requestId = await borrower.mutation(api.requests.create, { toolId, startDate: d, endDate: addDays(d, 2) });
    await expect(borrower.mutation(api.requests.decide, { requestId, approve: true })).rejects.toThrow(/Not found/);
    await expect(intruder.mutation(api.requests.decide, { requestId, approve: true })).rejects.toThrow(/Not found/);
    await owner.mutation(api.requests.decide, { requestId, approve: true });
    const [row] = await borrower.query(api.requests.mine, {});
    expect(row.status).toBe("approved");
  });

  test("approving a loan declines overlapping pending requests", async () => {
    const { owner, borrower, intruder, toolId } = await setup();
    const d = today();
    const first = await borrower.mutation(api.requests.create, { toolId, startDate: d, endDate: addDays(d, 3) });
    await intruder.mutation(api.requests.create, { toolId, startDate: addDays(d, 2), endDate: addDays(d, 4) });
    await owner.mutation(api.requests.decide, { requestId: first, approve: true });
    const [other] = await intruder.query(api.requests.mine, {});
    expect(other.status).toBe("declined");
  });

  test("past dates and over-long loans are rejected", async () => {
    const { borrower, toolId } = await setup();
    const d = today();
    await expect(
      borrower.mutation(api.requests.create, { toolId, startDate: addDays(d, -1), endDate: d }),
    ).rejects.toThrow(/past/);
    await expect(
      borrower.mutation(api.requests.create, { toolId, startDate: d, endDate: addDays(d, 40) }),
    ).rejects.toThrow(/at most/);
  });

  test("a stranger can't mark someone else's loan returned", async () => {
    const { owner, borrower, intruder, toolId } = await setup();
    const d = today();
    const requestId = await borrower.mutation(api.requests.create, { toolId, startDate: d, endDate: d });
    await owner.mutation(api.requests.decide, { requestId, approve: true });
    await expect(intruder.mutation(api.requests.markReturned, { requestId })).rejects.toThrow(/Not found/);
    await expect(borrower.mutation(api.requests.markReturned, { requestId })).rejects.toThrow(/Not found/);
    await owner.mutation(api.requests.markReturned, { requestId });
  });
});

describe("admin", () => {
  test("admin-only functions reject normal users", async () => {
    const { owner, borrower } = await setup();
    await expect(owner.query(api.requests.listAll, {})).rejects.toThrow(/Admins only/);
    const me = await borrower.query(api.users.viewer, {});
    await expect(owner.mutation(api.users.setTrustedLender, { userId: me!._id, trusted: true })).rejects.toThrow(
      /Admins only/,
    );
  });

  test("new users can't make themselves admin by signing in", async () => {
    const { intruder } = await setup();
    expect((await intruder.query(api.users.viewer, {}))?.role).toBe("user");
  });
});

describe("n8n endpoints", () => {
  async function overdueLoan(t: Awaited<ReturnType<typeof setup>>) {
    const d = today();
    return await t.t.run(async (ctx) => {
      const tool = (await ctx.db.get(t.toolId))!;
      const borrower = (await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", BORROWER.email)).unique())!;
      return await ctx.db.insert("requests", {
        toolId: tool._id,
        toolName: tool.name,
        ownerId: tool.ownerId,
        borrowerId: borrower._id,
        startDate: addDays(d, -5),
        endDate: addDays(d, -2),
        status: "approved",
      });
    });
  }

  async function signed(method: string, path: string, body = "") {
    const { timestamp, signature } = await signRequest(SECRET, method, path, body);
    return {
      method,
      headers: { "X-LendLoop-Timestamp": timestamp, "X-LendLoop-Signature": signature, "Content-Type": "application/json" },
      ...(body ? { body } : {}),
    };
  }

  test("unsigned and wrongly signed calls get 401", async () => {
    const { t } = await setup();
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET" })).status).toBe(401);
    const bad = await signRequest("wrong-secret", "GET", "/n8n/overdue-loans", "");
    const res = await t.fetch("/n8n/overdue-loans", {
      method: "GET",
      headers: { "X-LendLoop-Timestamp": bad.timestamp, "X-LendLoop-Signature": bad.signature },
    });
    expect(res.status).toBe(401);
  });

  test("a signature for one endpoint can't be replayed on another", async () => {
    const { t } = await setup();
    const body = JSON.stringify({ executionId: "1" });
    const init = await signed("POST", "/n8n/workflow-error", body);
    expect((await t.fetch("/n8n/notification-status", init)).status).toBe(401);
  });

  test("overdue list returns only what a reminder needs", async () => {
    const s = await setup();
    await overdueLoan(s);
    const res = await s.t.fetch("/n8n/overdue-loans", await signed("GET", "/n8n/overdue-loans"));
    expect(res.status).toBe(200);
    const { loans } = await res.json();
    expect(loans).toHaveLength(1);
    expect(Object.keys(loans[0]).sort()).toEqual(
      ["borrowerEmail", "borrowerName", "daysOverdue", "endDate", "loanId", "reminderDate", "toolName"].sort(),
    );
    expect(loans[0].daysOverdue).toBe(2);
  });

  test("reminder write-back is idempotent and hides the loan from today's re-run", async () => {
    const s = await setup();
    const loanId: Id<"requests"> = await overdueLoan(s);
    const body = JSON.stringify({ loanId, status: "sent", channel: "email", reminderDate: today() });

    const first = await s.t.fetch("/n8n/reminder-status", await signed("POST", "/n8n/reminder-status", body));
    const second = await s.t.fetch("/n8n/reminder-status", await signed("POST", "/n8n/reminder-status", body));
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false });
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true });

    const events = await s.t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events.filter((e) => e.kind === "reminder_sent")).toHaveLength(1);

    const rerun = await s.t.fetch("/n8n/overdue-loans", await signed("GET", "/n8n/overdue-loans"));
    expect((await rerun.json()).loans).toHaveLength(0);

    // Bonus: the borrower sees the activity on their loan.
    const [mine] = await s.borrower.query(api.requests.mine, {});
    expect(mine.activity[0]).toMatchObject({ kind: "reminder_sent", channel: "email" });
  });
});
