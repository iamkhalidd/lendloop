"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { errorMessage, formatDate, todayIso } from "@/lib/labels";
import {
  Activity,
  Card,
  Empty,
  Loading,
  PageHeader,
  RequestStatus,
  TrustedBadge,
  primaryButton,
  secondaryButton,
} from "@/components/ui";

export default function IncomingPage() {
  const rows = useQuery(api.requests.incoming);

  return (
    <>
      <PageHeader title="Incoming requests" subtitle="People who want to borrow your tools." />
      {rows === undefined ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No requests yet. They&apos;ll show up here when someone asks to borrow your tools.</Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r._id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{r.toolName}</h2>
                  <p className="text-sm text-stone-500">
                    {r.counterpartName}
                    {r.counterpartTrusted && <TrustedBadge />} · {formatDate(r.startDate)} – {formatDate(r.endDate)}
                  </p>
                  {r.message && <p className="mt-2 text-sm italic text-stone-700">&ldquo;{r.message}&rdquo;</p>}
                  {r.closedReason && <p className="mt-1 text-sm text-stone-500">{r.closedReason}.</p>}
                </div>
                <RequestStatus status={r.status} overdue={r.overdue} />
              </div>
              <Actions requestId={r._id} status={r.status} startDate={r.startDate} />
              <Activity items={r.activity} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Actions({ requestId, status, startDate }: { requestId: Id<"requests">; status: string; startDate: string }) {
  const decide = useMutation(api.requests.decide);
  const markReturned = useMutation(api.requests.markReturned);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (status === "pending") {
    return (
      <div className="mt-3">
        <div className="flex gap-2">
          <button disabled={busy} className={primaryButton} onClick={() => run(() => decide({ requestId, approve: true }))}>
            Approve
          </button>
          <button disabled={busy} className={secondaryButton} onClick={() => run(() => decide({ requestId, approve: false }))}>
            Decline
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      </div>
    );
  }
  if (status === "approved" && startDate <= todayIso()) {
    return (
      <div className="mt-3">
        <button disabled={busy} className={secondaryButton} onClick={() => run(() => markReturned({ requestId }))}>
          Mark as returned
        </button>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      </div>
    );
  }
  return null;
}
