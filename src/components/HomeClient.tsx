"use client";

import { useCallback, useEffect, useState } from "react";
import { POLL_MS } from "@/lib/constants";
import type { Activity, RankedListing } from "@/lib/types";
import { BidForm } from "./BidForm";
import { Board } from "./Board";
import { ActivityFeed } from "./ActivityFeed";

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

  return (
    <div className="mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-7">
      {listings.length > 0 ? (
        <p className="mb-3 text-xs text-white/50">
          {listings.length} on the board
        </p>
      ) : null}
      <div id="bid-form" className="grid gap-8 lg:grid-cols-[1fr_260px] lg:gap-10">
        <div className="space-y-8 sm:space-y-10">
          <BidForm listings={listings} onDone={refresh} />
          <Board listings={listings} />
        </div>
        <ActivityFeed events={events} />
      </div>
    </div>
  );
}

export default HomeClient;
