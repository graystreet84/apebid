"use client";

import { useEffect, useState } from "react";
import { POLL_MS } from "@/lib/constants";

export type TickerStats = {
  live: number;
  last12h: number;
  sinceLaunch: number;
  revenueSol: number;
};

export function Ticker({ initial }: { initial: TickerStats }) {
  const [s, setS] = useState<TickerStats>(initial);

  useEffect(() => {
    let dead = false;
    async function tick() {
      try {
        const data = await fetch("/api/state", { cache: "no-store" }).then((r) =>
          r.json()
        );
        if (dead) return;
        const visitors = data.visitors || {};
        setS({
          live: data.live ?? visitors.live ?? 0,
          last12h: data.last12h ?? visitors.last12h ?? 0,
          sinceLaunch: data.sinceLaunch ?? visitors.sinceLaunch ?? 0,
          revenueSol:
            data.revenueSol ??
            (typeof data.revenueUnits === "number" ? data.revenueUnits / 100 : 0),
        });
      } catch {
        /* keep last */
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  const rev = Number(s.revenueSol || 0).toFixed(2);

  return (
    <div className="apebid-ticker overflow-x-auto border-b-2 border-hot/80 bg-black px-3 py-1.5 text-xs font-bold sm:text-sm">
      <div className="inline-flex min-w-full items-center justify-center gap-x-4 whitespace-nowrap">
        <span className="text-acid">
          <span className="blink">●</span> {s.live} LIVE now
        </span>
        <span className="text-yell">{s.last12h} last 12h</span>
        <span className="text-hot">{s.sinceLaunch} since launch</span>
        <span className="text-white/70">{rev} SOL paid / revenue</span>
      </div>
    </div>
  );
}
