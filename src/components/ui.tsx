import type { ReactNode } from "react";
import { activityLabel, formatDate, timeAgo } from "@/lib/labels";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{children}</p>
  );
}

export function Loading() {
  return <p className="text-sm text-stone-400">Loading…</p>;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  declined: "bg-stone-100 text-stone-600 ring-stone-200",
  cancelled: "bg-stone-100 text-stone-600 ring-stone-200",
  returned: "bg-sky-50 text-sky-800 ring-sky-200",
  overdue: "bg-rose-50 text-rose-800 ring-rose-200",
  available: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  on_loan: "bg-stone-100 text-stone-700 ring-stone-200",
};

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[tone] ?? STATUS_STYLES.declined}`}>
      {children}
    </span>
  );
}

export function RequestStatus({ status, overdue }: { status: string; overdue: boolean }) {
  if (overdue) return <Badge tone="overdue">Overdue</Badge>;
  const label = status === "approved" ? "On loan / approved" : status[0].toUpperCase() + status.slice(1);
  return <Badge tone={status}>{label}</Badge>;
}

type Availability = { state: "available" } | { state: "on_loan"; until: string } | { state: "overdue"; since: string };

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  if (availability.state === "available") return <Badge tone="available">Available</Badge>;
  if (availability.state === "on_loan") return <Badge tone="on_loan">On loan until {formatDate(availability.until)}</Badge>;
  return <Badge tone="overdue">Overdue since {formatDate(availability.since)}</Badge>;
}

export function TrustedBadge() {
  return (
    <span title="Marked as a Trusted Lender by an admin" className="ml-1 text-xs font-medium text-emerald-700">
      ✓ Trusted Lender
    </span>
  );
}

/** Bonus: recent n8n activity on a loan, e.g. "Overdue reminder sent · 2 days ago". */
export function Activity({ items }: { items: { kind: string; channel: string | null; at: number }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 border-t border-stone-100 pt-2 text-xs text-stone-500">
      {items.map((a, i) => (
        <li key={i} className={a.kind.endsWith("failed") ? "text-rose-600" : undefined}>
          {activityLabel(a.kind)}
          {a.channel ? ` via ${a.channel}` : ""} · {timeAgo(a.at)}
        </li>
      ))}
    </ul>
  );
}

export const buttonClass =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButton = `${buttonClass} bg-emerald-700 text-white hover:bg-emerald-800`;
export const secondaryButton = `${buttonClass} border border-stone-300 bg-white text-stone-700 hover:bg-stone-50`;
export const dangerButton = `${buttonClass} border border-rose-200 bg-white text-rose-700 hover:bg-rose-50`;
export const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20";
