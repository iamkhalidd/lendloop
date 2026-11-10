"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { errorMessage, formatDate } from "@/lib/labels";
import { Activity, Card, Empty, Loading, PageHeader, RequestStatus, TrustedBadge, secondaryButton } from "@/components/ui";

export default function MyRequestsPage() {
  const rows = useQuery(api.requests.mine);

  return (
    <>
      <PageHeader title="My requests" subtitle="Things you've asked to borrow." />
      {rows === undefined ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>You haven&apos;t requested anything yet. Find something under Browse.</Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r._id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{r.toolName}</h2>
                  <p className="text-sm text-stone-500">
                    {formatDate(r.startDate)} – {formatDate(r.endDate)} · from {r.counterpartName}
                    {r.counterpartTrusted && <TrustedBadge />}
                  </p>
                  {r.overdue && (
                    <p className="mt-1 text-sm text-rose-700">This was due back on {formatDate(r.endDate)}. Please return it.</p>
                  )}
                  {r.closedReason && <p className="mt-1 text-sm text-stone-500">{r.closedReason}.</p>}
                </div>
                <RequestStatus status={r.status} overdue={r.overdue} />
              </div>
              {r.status === "pending" && <CancelButton requestId={r._id} />}
              <Activity items={r.activity} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function CancelButton({ requestId }: { requestId: Id<"requests"> }) {
  const cancel = useMutation(api.requests.cancel);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3">
      <button
        className={secondaryButton}
        onClick={async () => {
          try {
            await cancel({ requestId });
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        Cancel request
      </button>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
