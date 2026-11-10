export const CATEGORY_LABELS = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
} as const;

export const CONDITION_LABELS = {
  new: "New",
  good: "Good",
  fair: "Fair",
  worn: "Worn",
} as const;

export type Category = keyof typeof CATEGORY_LABELS;
export type Condition = keyof typeof CONDITION_LABELS;

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
export const CONDITIONS = Object.keys(CONDITION_LABELS) as Condition[];

const ACTIVITY_LABELS: Record<string, string> = {
  notification_sent: "Notification sent",
  notification_failed: "Notification failed",
  reminder_sent: "Overdue reminder sent",
  reminder_failed: "Overdue reminder failed",
  workflow_error: "Workflow error",
};

export function activityLabel(kind: string) {
  return ACTIVITY_LABELS[kind] ?? kind;
}

export function timeAgo(at: number, now: number = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Pull the human message out of a ConvexError thrown by a mutation. */
export function errorMessage(e: unknown) {
  if (e && typeof e === "object" && "data" in e && typeof (e as { data: unknown }).data === "string") {
    return (e as { data: string }).data;
  }
  return "Something went wrong. Please try again.";
}
