"use client";

import { formatSol, type Activity } from "@/lib/types";

export function ActivityFeed({ events }: { events: Activity[] }) {
  if (events.length === 0) return null;

  return (
    <section className="border border-white/25 bg-black/40 p-3 sm:p-4">
      <h2 className="font-smash text-lg text-yell sm:text-xl">JUST APED</h2>
      <ul className="mt-3 space-y-2">
        {events.map((e) => (
          <li
            key={e.id}
            className="border-l-2 border-white/25 bg-black/60 px-2 py-1 text-sm"
          >
            <span className="font-bold text-hot">
              {e.kind === "raise" ? "RAISE" : "BID"}
            </span>{" "}
            <span className="text-acid">{e.ticker || e.name}</span> → #{e.rank} at{" "}
            {formatSol(e.bidUnits)} SOL{" "}
            <span className="text-white/50">
              (paid {formatSol(e.paidUnits)} SOL)
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
