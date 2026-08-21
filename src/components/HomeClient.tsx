"use client";

import { useCallback, useEffect, useState } from "react";
import { POLL_MS } from "@/lib/constants";
import type { Activity, RankedListing } from "@/lib/types";
import { BidForm } from "./BidForm";
import { Board } from "./Board";
import { ActivityFeed } from "./ActivityFeed";
import { WalletButton } from "./WalletButton";

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
    <div className="mx-auto max-w-5xl px-3 py-6 sm:px-4">
      <div className="mb-4 flex items-center justify-end">
        <WalletButton />
      </div>
      <p className="mb-4 text-center text-sm text-white/60">
        {listings.length} on the board
      </p>
      <div id="bid-form" className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          <BidForm listings={listings} onDone={refresh} />
          <Board listings={listings} />
        </div>
        <ActivityFeed events={events} />
      </div>
    </div>
  );
}

export default HomeClient;
