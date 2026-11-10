"use client";

import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CATEGORY_LABELS } from "@/lib/labels";
import { primaryButton } from "@/components/ui";

export default function Home() {
  // Public query: returns only name + category. No owner or condition data
  // leaves the server for signed-out visitors.
  const tools = useQuery(api.tools.listPublic);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">LendLoop</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Borrow what you need. Lend what you don&apos;t.</h1>
      <p className="mt-3 max-w-xl text-stone-600">
        A neighbourhood tool library. List the drill you use twice a year, borrow a tent for the weekend.
      </p>

      <div className="mt-6">
        <AuthLoading>
          <span className="text-sm text-stone-400">Checking your session…</span>
        </AuthLoading>
        <Unauthenticated>
          <SignInButton mode="modal" forceRedirectUrl="/tools">
            <button className={primaryButton}>Sign in to lend or borrow</button>
          </SignInButton>
        </Unauthenticated>
        <Authenticated>
          <Link href="/tools" className={primaryButton}>
            Open LendLoop
          </Link>
        </Authenticated>
      </div>

      <section className="mt-12">
        <h2 className="text-sm font-semibold text-stone-500">Available right now</h2>
        {tools === undefined ? (
          <p className="mt-3 text-sm text-stone-400">Loading…</p>
        ) : tools.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">Nothing listed yet. Be the first to lend something.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
            {tools.map((t) => (
              <li key={t._id} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">{t.name}</span>
                <span className="text-sm text-stone-500">{CATEGORY_LABELS[t.category]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
