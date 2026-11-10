"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { activityLabel, CATEGORY_LABELS, errorMessage, formatDate, timeAgo } from "@/lib/labels";
import { Activity, Card, Empty, Loading, PageHeader, RequestStatus, dangerButton, secondaryButton } from "@/components/ui";

export default function AdminPage() {
  const viewer = useQuery(api.users.viewer);
  if (viewer === undefined) return <Loading />;
  // The UI check is cosmetic; each admin query below throws for non-admins.
  if (viewer?.role !== "admin") return <Empty>This page is for admins.</Empty>;

  return (
    <>
      <PageHeader title="Admin" subtitle="All loans, all listings, members and automation health." />
      <div className="space-y-10">
        <Failures />
        <Loans />
        <Listings />
        <Members />
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Failures() {
  const rows = useQuery(api.automation.recentFailures);
  return (
    <Section title="Automation failures">
      {rows === undefined ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No failed notifications, reminders or workflow runs.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {rows.map((f) => (
              <li key={f._id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="text-rose-700">{activityLabel(f.kind)}</span>
                <span className="flex-1 text-stone-600">{f.detail}</span>
                <span className="text-stone-400">{timeAgo(f.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}

function Loans() {
  const rows = useQuery(api.requests.listAll);
  const markReturned = useMutation(api.requests.markReturned);
  return (
    <Section title="All loans and requests">
      {rows === undefined ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No requests yet.</Empty>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r._id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium">{r.toolName}</span>
                  <span className="text-stone-500">
                    {" "}
                    · {r.ownerName} → {r.borrowerName} · {formatDate(r.startDate)} – {formatDate(r.endDate)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <RequestStatus status={r.status} overdue={r.overdue} />
                  {r.overdue && (
                    <button className={secondaryButton} onClick={() => markReturned({ requestId: r._id })}>
                      Mark returned
                    </button>
                  )}
                </div>
              </div>
              <Activity items={r.activity} />
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

function Listings() {
  const tools = useQuery(api.tools.list, {});
  const remove = useMutation(api.tools.remove);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="All listings">
      {error && <p className="mb-2 text-sm text-rose-700">{error}</p>}
      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty>No listings.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {tools.map((t) => (
              <li key={t._id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{t.name}</span>
                  <span className="text-stone-500">
                    {" "}
                    · {CATEGORY_LABELS[t.category]} · {t.isMine ? "you" : t.ownerName}
                  </span>
                </span>
                <button
                  className={dangerButton}
                  onClick={async () => {
                    if (!confirm(`Remove "${t.name}" for everyone? Open requests will be cancelled.`)) return;
                    try {
                      await remove({ toolId: t._id });
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}

function Members() {
  const users = useQuery(api.users.listForAdmin);
  const setTrusted = useMutation(api.users.setTrustedLender);
  return (
    <Section title="Members">
      {users === undefined ? (
        <Loading />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {users.map((u) => (
              <li key={u._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{u.name}</span>
                  <span className="text-stone-500"> · {u.email || "no email"} · {u.role}</span>
                </span>
                <label className="flex items-center gap-2 text-stone-700">
                  <input
                    type="checkbox"
                    checked={u.trustedLender}
                    onChange={(e) => setTrusted({ userId: u._id, trusted: e.target.checked })}
                  />
                  Trusted Lender
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}
