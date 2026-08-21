"use client";

import { formatSol, type Activity } from "@/lib/types";

export function ActivityFeed({ events }: { events: Activity[] }) {
  return (
    <section className="ugly-box p-4">
      <h2 className="font-smash text-2xl text-yell">JUST APED</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-white/50">no activity yet. poll every 5s.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="border-2 border-white/20 bg-black px-2 py-1 text-sm"
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
      )}
    </section>
  );
}
