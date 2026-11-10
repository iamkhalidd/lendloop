"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CATEGORIES, CATEGORY_LABELS, CONDITION_LABELS, errorMessage, formatDate, todayIso, type Category } from "@/lib/labels";
import { AvailabilityBadge, Card, Empty, Loading, PageHeader, TrustedBadge, inputClass, primaryButton, secondaryButton } from "@/components/ui";

export default function BrowsePage() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.list, category ? { category } : {});

  return (
    <>
      <PageHeader title="Browse tools" subtitle="Everything listed by members, with what's free right now.">
        <select
          aria-label="Filter by category"
          className={`${inputClass} w-auto`}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | "")}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </PageHeader>

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty>No tools in this category yet.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tools.map((t) => (
            <Card key={t._id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{t.name}</h2>
                  <p className="text-sm text-stone-500">
                    {CATEGORY_LABELS[t.category]} · {CONDITION_LABELS[t.condition]} condition
                  </p>
                </div>
                <AvailabilityBadge availability={t.availability} />
              </div>
              <p className="mt-2 text-sm text-stone-700">{t.description}</p>
              <p className="mt-2 text-xs text-stone-500">
                Lent by {t.isMine ? "you" : t.ownerName}
                {t.ownerTrusted && <TrustedBadge />}
              </p>
              {!t.isMine && (
                <div className="mt-3">
                  {t.myOpenRequest ? (
                    <p className="text-sm text-stone-600">
                      You requested {formatDate(t.myOpenRequest.startDate)} – {formatDate(t.myOpenRequest.endDate)} (
                      {t.myOpenRequest.status}).
                    </p>
                  ) : (
                    <RequestForm toolId={t._id} />
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function RequestForm({ toolId }: { toolId: Id<"tools"> }) {
  const create = useMutation(api.requests.create);
  const [open, setOpen] = useState(false);
  const [startDate, setStart] = useState(todayIso());
  const [endDate, setEnd] = useState(todayIso());
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className={secondaryButton} onClick={() => setOpen(true)}>
        Request to borrow
      </button>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await create({ toolId, startDate, endDate, message: message || undefined });
          setOpen(false);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-stone-600">
          From
          <input type="date" required min={todayIso()} className={inputClass} value={startDate} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="text-xs text-stone-600">
          Until
          <input type="date" required min={startDate} className={inputClass} value={endDate} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <input
        className={inputClass}
        placeholder="Optional note for the owner"
        maxLength={300}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          Send request
        </button>
        <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
