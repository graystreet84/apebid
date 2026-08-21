"use client";

import { useCallback, useEffect, useState } from "react";
import { MIN_SOL, POLL_MS } from "@/lib/constants";
import {
  formatSol,
  unitsToSol,
  type Activity,
  type RankedListing,
} from "@/lib/types";
import { BidForm } from "./BidForm";
import { Board } from "./Board";
import { ActivityFeed } from "./ActivityFeed";

/** Same math as Board claim #1: current #1 + one step, or the 0.05 minimum. */
function claimFirstSol(listings: RankedListing[]): number {
  const top = listings[0];
  if (!top) return MIN_SOL;
  return Math.round((unitsToSol(top.bidUnits) + 0.01) * 100) / 100;
}

function goToBidForm(sol: number) {
  window.dispatchEvent(new CustomEvent("apebid-claim", { detail: sol }));
  document.getElementById("bid-form")?.scrollIntoView({ behavior: "smooth" });
}

export function HomeClient() {
  const [listings, setListings] = useState<RankedListing[]>([]);
  const [events, setEvents] = useState<Activity[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await fetch("/api/state", { cache: "no-store" }).then((x) =>
        x.json()
      );
      setListings(data.listings || []);
      setEvents(data.activity || []);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const top = listings[0];
  const claimLabel = top
    ? `claim #1 for ${formatSol(top.bidUnits + 1)} SOL`
    : "claim #1 for 0.05 SOL";

  return (
    <div className="mx-auto max-w-5xl px-3 pb-5 sm:px-4 sm:pb-7">
      <div className="flex justify-center pb-6 pt-4 sm:pb-8 sm:pt-5">
        <button
          type="button"
          className="ugly-cta w-full max-w-md px-5 py-3 font-smash text-2xl sm:w-auto sm:px-8 sm:text-3xl"
          onClick={() => goToBidForm(claimFirstSol(listings))}
        >
          {claimLabel}
        </button>
      </div>

      {listings.length > 0 ? (
        <p className="mb-3 text-xs text-white/50">
          {listings.length} on the board
        </p>
      ) : null}

      <div
        className={
          events.length > 0
            ? "grid gap-8 lg:grid-cols-[1fr_260px] lg:items-start lg:gap-10"
            : undefined
        }
      >
        <Board listings={listings} />
        <ActivityFeed events={events} />
      </div>

      <div className="mx-auto mt-8 max-w-2xl sm:mt-10">
        <BidForm listings={listings} onDone={refresh} />
      </div>
    </div>
  );
}

export default HomeClient;
