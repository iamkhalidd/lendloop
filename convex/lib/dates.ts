import { ConvexError } from "convex/values";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_LOAN_DAYS = 30;

/** Today's date in UTC as YYYY-MM-DD. All loan dates are whole UTC days. */
export function today(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function assertLoanRange(startDate: string, endDate: string, now: number = Date.now()) {
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    throw new ConvexError("Dates must be valid and in YYYY-MM-DD format.");
  }
  if (startDate < today(now)) throw new ConvexError("The start date can't be in the past.");
  if (endDate < startDate) throw new ConvexError("The end date must be on or after the start date.");
  if (daysBetween(startDate, endDate) + 1 > MAX_LOAN_DAYS) {
    throw new ConvexError(`Loans can be at most ${MAX_LOAN_DAYS} days.`);
  }
}

/** Inclusive date ranges overlap when neither ends before the other starts. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}
