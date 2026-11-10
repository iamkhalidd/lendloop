// Generates the importable n8n workflow JSON files in this folder.
// The Code node source lives here as readable JS rather than escaped strings.
// Run: node n8n/build-workflows.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const IDS = {
  notify: "LendLoopNotify01",
  overdue: "LendLoopOverdue1",
  errors: "LendLoopErrors01",
};
const NOTIFY_PATH = "lendloop-notify";

// Shared signing helper pasted into every Code node that calls Convex.
// Must match convex/lib/hmac.ts: `${ts}.${METHOD}.${path}.${body}`.
const SIGN = `
const crypto = require('crypto');
function sign(method, path, body) {
  const secret = $env.N8N_TO_CONVEX_SECRET;
  if (!secret) throw new Error('N8N_TO_CONVEX_SECRET is not set');
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', secret)
    .update(ts + '.' + method + '.' + path + '.' + body).digest('hex');
  return { ts, sig, body, url: $env.CONVEX_SITE_URL.replace(/\\/$/, '') + path };
}`.trim();

let x = 0;
const pos = () => [x += 240, 300];

function node(name, type, typeVersion, parameters, extra = {}) {
  return { id: crypto.randomUUID(), name, type, typeVersion, position: pos(), parameters, ...extra };
}
function code(name, js) {
  return node(name, "n8n-nodes-base.code", 2, { mode: "runOnceForAllItems", jsCode: js.trim() });
}
/** HTTP call to Convex using the ts/sig/body/url produced by a signing Code node. */
function signedHttp(name, method) {
  return node(
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method,
      url: "={{ $json.url }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "X-LendLoop-Timestamp", value: "={{ $json.ts }}" },
          { name: "X-LendLoop-Signature", value: "={{ $json.sig }}" },
        ],
      },
      ...(method === "POST"
        ? { sendBody: true, contentType: "raw", rawContentType: "application/json", body: "={{ $json.body }}" }
        : {}),
      options: { timeout: 10000 },
    },
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 },
  );
}
function chain(...nodes) {
  const c = {};
  for (let i = 0; i < nodes.length - 1; i++) {
    c[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: "main", index: 0 }]] };
  }
  return c;
}
function workflow(id, name, nodes, connections, settings = {}) {
  return {
    id,
    name,
    active: false,
    nodes,
    connections,
    settings: { executionOrder: "v1", ...settings },
    pinData: {},
    tags: [],
  };
}
function write(file, wf) {
  writeFileSync(join(here, file), JSON.stringify(wf, null, 2) + "\n");
  console.log("wrote", file);
}

// ---------------------------------------------------------------------------
// 1. Request notifications: Convex -> n8n webhook -> notify -> write back.
// ---------------------------------------------------------------------------
{
  x = 0;
  const hook = node(
    "Convex webhook",
    "n8n-nodes-base.webhook",
    2,
    { httpMethod: "POST", path: NOTIFY_PATH, responseMode: "responseNode", options: { rawBody: true } },
    { webhookId: "3f1c9a52-6a7e-4f0e-9a3b-6c1e0d0a0001" },
  );
  const verify = code(
    "Verify signature",
    `
// Recompute the HMAC over the exact raw bytes Convex sent.
const crypto = require('crypto');
const item = $input.first();
const headers = item.json.headers || {};
const ts = headers['x-lendloop-timestamp'] || '';
const sig = String(headers['x-lendloop-signature'] || '').toLowerCase();
const secret = $env.CONVEX_TO_N8N_SECRET;

let raw = '';
if (item.binary && item.binary.data) {
  raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
}

let valid = false;
if (secret && /^\\d{1,12}$/.test(ts) && Math.abs(Date.now() / 1000 - Number(ts)) <= 300) {
  const expected = crypto.createHmac('sha256', secret)
    .update(ts + '.POST./webhook/${NOTIFY_PATH}.' + raw).digest('hex');
  valid = expected.length === sig.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

let payload = null;
if (valid) { try { payload = JSON.parse(raw); } catch { valid = false; } }
// Never pass headers or the raw body further down the workflow.
return [{ json: { valid, payload } }];
`,
  );
  const ifValid = node("Signature valid?", "n8n-nodes-base.if", 2, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [
        {
          id: "c1",
          leftValue: "={{ $json.valid }}",
          rightValue: true,
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
      combinator: "and",
    },
    options: {},
  });
  const reject = node("Respond 401", "n8n-nodes-base.respondToWebhook", 1.1, {
    respondWith: "json",
    responseBody: '={"error":"unauthorized"}',
    options: { responseCode: 401 },
  });
  const accept = node("Respond 202", "n8n-nodes-base.respondToWebhook", 1.1, {
    respondWith: "json",
    responseBody: '={"ok":true}',
    options: { responseCode: 202 },
  });
  const notify = code(
    "Send notification (mock)",
    `
// Mock channel. Swap this node for Send Email / Slack; keep the output shape.
const p = $('Verify signature').first().json.payload;
const subjects = {
  'request.created': p.otherPartyName + ' wants to borrow your ' + p.toolName,
  'request.cancelled': p.otherPartyName + ' cancelled their request for your ' + p.toolName,
  'request.approved': 'Your request for the ' + p.toolName + ' was approved',
  'request.declined': 'Your request for the ' + p.toolName + ' was declined',
  'request.returned': 'Thanks for returning the ' + p.toolName,
};
const message = {
  to: p.recipient.email,
  subject: subjects[p.event] || 'LendLoop update',
  text: 'Hi ' + p.recipient.name + ', ' + (subjects[p.event] || '') +
    ' (' + p.startDate + ' to ' + p.endDate + ').' + (p.reason ? ' Reason: ' + p.reason : ''),
};
console.log('[mock notify]', JSON.stringify(message));
return [{ json: { eventId: p.eventId, status: 'sent', channel: 'mock-email' } }];
`,
  );
  const signBack = code(
    "Sign write-back",
    `
${SIGN}
const r = $input.first().json;
const body = JSON.stringify({ eventId: r.eventId, status: r.status, channel: r.channel });
return [{ json: sign('POST', '/n8n/notification-status', body) }];
`,
  );
  const writeBack = signedHttp("Record in Convex", "POST");

  write(
    "notify.json",
    workflow(
      IDS.notify,
      "LendLoop · request notifications",
      [hook, verify, ifValid, reject, accept, notify, signBack, writeBack],
      {
        ...chain(hook, verify, ifValid),
        [ifValid.name]: {
          main: [
            [{ node: accept.name, type: "main", index: 0 }],
            [{ node: reject.name, type: "main", index: 0 }],
          ],
        },
        ...chain(accept, notify, signBack, writeBack),
      },
      { errorWorkflow: IDS.errors },
    ),
  );
}

// ---------------------------------------------------------------------------
// 2. Daily overdue reminders: schedule -> fetch -> remind each -> write back.
// ---------------------------------------------------------------------------
{
  x = 0;
  const cron = node("Every day 08:00", "n8n-nodes-base.scheduleTrigger", 1.2, {
    rule: { interval: [{ field: "cronExpression", expression: "0 8 * * *" }] },
  });
  const signGet = code(
    "Sign overdue query",
    `
${SIGN}
return [{ json: sign('GET', '/n8n/overdue-loans', '') }];
`,
  );
  const fetchOverdue = signedHttp("Fetch overdue loans", "GET");
  const split = code(
    "One item per loan",
    `
// Convex already skips loans that got today's reminder, so re-runs are safe.
const loans = $input.first().json.loans || [];
return loans.map((loan) => ({ json: loan }));
`,
  );
  const remind = code(
    "Send reminder (mock)",
    `
// Mock channel. Swap for Send Email / Slack; keep the output shape.
return $input.all().map(({ json: l }) => {
  console.log('[mock reminder]', JSON.stringify({
    to: l.borrowerEmail,
    subject: 'Please return the ' + l.toolName,
    text: 'Hi ' + l.borrowerName + ', the ' + l.toolName + ' was due back on ' + l.endDate +
      ' (' + l.daysOverdue + ' day' + (l.daysOverdue === 1 ? '' : 's') + ' ago).',
  }));
  return { json: { loanId: l.loanId, reminderDate: l.reminderDate, status: 'sent', channel: 'mock-email' } };
});
`,
  );
  const signBack = code(
    "Sign write-backs",
    `
${SIGN}
return $input.all().map(({ json: r }) => ({
  json: sign('POST', '/n8n/reminder-status', JSON.stringify({
    loanId: r.loanId, reminderDate: r.reminderDate, status: r.status, channel: r.channel,
  })),
}));
`,
  );
  const writeBack = signedHttp("Record reminder in Convex", "POST");

  write(
    "overdue-reminders.json",
    workflow(
      IDS.overdue,
      "LendLoop · overdue reminders",
      [cron, signGet, fetchOverdue, split, remind, signBack, writeBack],
      chain(cron, signGet, fetchOverdue, split, remind, signBack, writeBack),
      { errorWorkflow: IDS.errors },
    ),
  );
}

// ---------------------------------------------------------------------------
// 3. Error handler: any failed execution above is reported to Convex.
// ---------------------------------------------------------------------------
{
  x = 0;
  const trigger = node("On workflow error", "n8n-nodes-base.errorTrigger", 1, {});
  const signErr = code(
    "Sign error report",
    `
${SIGN}
const e = $input.first().json;
const body = JSON.stringify({
  executionId: String((e.execution && e.execution.id) || 'trigger-' + Date.now()),
  workflowName: (e.workflow && e.workflow.name) || 'unknown',
  // Message only: no stack traces or node input data leave n8n.
  message: String((e.execution && e.execution.error && e.execution.error.message) ||
    (e.trigger && e.trigger.error && e.trigger.error.message) || 'unknown error').slice(0, 400),
});
return [{ json: sign('POST', '/n8n/workflow-error', body) }];
`,
  );
  const report = signedHttp("Report to Convex", "POST");
  write(
    "error-handler.json",
    workflow(IDS.errors, "LendLoop · error handler", [trigger, signErr, report], chain(trigger, signErr, report)),
  );
}
