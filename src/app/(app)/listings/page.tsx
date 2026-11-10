"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  errorMessage,
  type Category,
  type Condition,
} from "@/lib/labels";
import {
  AvailabilityBadge,
  Card,
  Empty,
  Loading,
  PageHeader,
  dangerButton,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/ui";

type ToolInput = { name: string; category: Category; condition: Condition; description: string };
const EMPTY: ToolInput = { name: "", category: "power_tools", condition: "good", description: "" };

export default function ListingsPage() {
  const tools = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader title="My listings" subtitle="Tools you're lending to the neighbourhood.">
        {!adding && (
          <button className={primaryButton} onClick={() => setAdding(true)}>
            List a tool
          </button>
        )}
      </PageHeader>

      {adding && (
        <div className="mb-6">
          <Card>
            <ToolForm
              initial={EMPTY}
              submitLabel="List tool"
              onSubmit={async (v) => {
                await create(v);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </Card>
        </div>
      )}

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty>You haven&apos;t listed anything yet.</Empty>
      ) : (
        <div className="space-y-3">
          {tools.map((t) => (
            <ListingRow key={t._id} tool={t} />
          ))}
        </div>
      )}
    </>
  );
}

type Listing = FunctionReturnType<typeof api.tools.mine>[number];

function ListingRow({ tool }: { tool: Listing }) {
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <Card>
        <ToolForm
          initial={tool}
          submitLabel="Save changes"
          onSubmit={async (v) => {
            await update({ toolId: tool._id as Id<"tools">, ...v });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{tool.name}</h2>
          <p className="text-sm text-stone-500">
            {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]} condition
            {tool.pendingRequests > 0 && ` · ${tool.pendingRequests} pending request${tool.pendingRequests === 1 ? "" : "s"}`}
          </p>
          <p className="mt-2 text-sm text-stone-700">{tool.description}</p>
        </div>
        <AvailabilityBadge availability={tool.availability} />
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button className={secondaryButton} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          className={dangerButton}
          onClick={async () => {
            if (!confirm(`Remove "${tool.name}"? Open requests on it will be cancelled.`)) return;
            try {
              await remove({ toolId: tool._id });
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          Remove
        </button>
      </div>
    </Card>
  );
}

function ToolForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ToolInput;
  submitLabel: string;
  onSubmit: (v: ToolInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [v, setV] = useState<ToolInput>({
    name: initial.name,
    category: initial.category,
    condition: initial.condition,
    description: initial.description,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(v);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm text-stone-700">
        Name
        <input required maxLength={80} className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-stone-700">
          Category
          <select className={inputClass} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-stone-700">
          Condition
          <select className={inputClass} value={v.condition} onChange={(e) => setV({ ...v, condition: e.target.value as Condition })}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm text-stone-700">
        Short description
        <textarea
          required
          maxLength={500}
          rows={3}
          className={inputClass}
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
        />
      </label>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {submitLabel}
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
