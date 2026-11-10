// @vitest-environment node
/**
 * n8n isn't run in CI, so this executes the Code-node source from the exported
 * workflow JSON with small stand-ins for n8n's globals, and checks it against
 * the Convex HMAC implementation in both directions.
 */
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { signRequest, verifyRequest } from "../convex/lib/hmac";
import notify from "./notify.json";
import overdue from "./overdue-reminders.json";

const nodeRequire = createRequire(import.meta.url);
type Item = { json: Record<string, unknown>; binary?: Record<string, unknown> };

function codeOf(wf: { nodes: { name: string; parameters: { jsCode?: string } }[] }, name: string) {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n?.parameters.jsCode) throw new Error(`no code node ${name}`);
  return n.parameters.jsCode;
}

async function runCode(
  js: string,
  { items, env, raw, named = {} }: { items: Item[]; env: Record<string, string>; raw?: string; named?: Record<string, Item[]> },
) {
  const $input = { first: () => items[0], all: () => items };
  const $ = (name: string) => ({ first: () => named[name][0], all: () => named[name] });
  const helpers = { getBinaryDataBuffer: async () => Buffer.from(raw ?? "", "utf8") };
  const fn = new Function("$input", "$env", "$", "require", "console", `return (async function(){${js}}).call(this);`);
  return (await fn.call({ helpers }, $input, env, $, nodeRequire, { log() {} })) as Item[];
}

const C2N = "convex-to-n8n-secret";
const N2C = "n8n-to-convex-secret";
const env = { CONVEX_TO_N8N_SECRET: C2N, N8N_TO_CONVEX_SECRET: N2C, CONVEX_SITE_URL: "https://example.convex.site/" };

describe("notify workflow", () => {
  const verifyJs = codeOf(notify, "Verify signature");
  const body = JSON.stringify({ eventId: "abc:request.created", event: "request.created" });

  async function verifyWith(headers: Record<string, string>, rawBody = body) {
    const items = [{ json: { headers }, binary: { data: {} } }];
    return (await runCode(verifyJs, { items, env, raw: rawBody }))[0].json;
  }

  test("accepts a request Convex signed for the webhook path", async () => {
    const { timestamp, signature } = await signRequest(C2N, "POST", "/webhook/lendloop-notify", body);
    const out = await verifyWith({ "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature });
    expect(out).toEqual({ valid: true, payload: JSON.parse(body) });
  });

  test("rejects tampered body, wrong secret, and stale timestamp", async () => {
    const good = await signRequest(C2N, "POST", "/webhook/lendloop-notify", body);
    const h = { "x-lendloop-timestamp": good.timestamp, "x-lendloop-signature": good.signature };
    expect((await verifyWith(h, body.replace("created", "approved"))).valid).toBe(false);

    const wrong = await signRequest("nope", "POST", "/webhook/lendloop-notify", body);
    expect(
      (await verifyWith({ "x-lendloop-timestamp": wrong.timestamp, "x-lendloop-signature": wrong.signature })).valid,
    ).toBe(false);

    const old = Math.floor(Date.now() / 1000) - 600;
    const stale = await signRequest(C2N, "POST", "/webhook/lendloop-notify", body, old);
    expect(
      (await verifyWith({ "x-lendloop-timestamp": stale.timestamp, "x-lendloop-signature": stale.signature })).valid,
    ).toBe(false);
    expect((await verifyWith({})).valid).toBe(false);
  });

  test("write-back is signed in a way Convex accepts", async () => {
    const [out] = await runCode(codeOf(notify, "Sign write-back"), {
      items: [{ json: { eventId: "abc:request.created", status: "sent", channel: "mock-email" } }],
      env,
    });
    const { ts, sig, body: b, url } = out.json as Record<string, string>;
    expect(url).toBe("https://example.convex.site/n8n/notification-status");
    expect(await verifyRequest(N2C, "POST", "/n8n/notification-status", b, ts, sig)).toEqual({ ok: true });
  });
});

describe("overdue workflow", () => {
  test("GET signature and per-loan write-backs verify in Convex", async () => {
    const [get] = await runCode(codeOf(overdue, "Sign overdue query"), { items: [{ json: {} }], env });
    const g = get.json as Record<string, string>;
    expect(await verifyRequest(N2C, "GET", "/n8n/overdue-loans", "", g.ts, g.sig)).toEqual({ ok: true });

    const loans = [
      { loanId: "l1", reminderDate: "2026-11-10", borrowerName: "Bisi", borrowerEmail: "b@example.com", toolName: "Drill", endDate: "2026-11-08", daysOverdue: 2 },
      { loanId: "l2", reminderDate: "2026-11-10", borrowerName: "Ivo", borrowerEmail: "i@example.com", toolName: "Saw", endDate: "2026-11-09", daysOverdue: 1 },
    ];
    const split = await runCode(codeOf(overdue, "One item per loan"), { items: [{ json: { loans } }], env });
    const reminded = await runCode(codeOf(overdue, "Send reminder (mock)"), { items: split, env });
    const signed = await runCode(codeOf(overdue, "Sign write-backs"), { items: reminded, env });
    expect(signed).toHaveLength(2);
    for (const s of signed) {
      const { ts, sig, body } = s.json as Record<string, string>;
      expect(await verifyRequest(N2C, "POST", "/n8n/reminder-status", body, ts, sig)).toEqual({ ok: true });
      // Only the fields Convex needs go back; no email or name.
      expect(Object.keys(JSON.parse(body)).sort()).toEqual(["channel", "loanId", "reminderDate", "status"]);
    }
  });
});
