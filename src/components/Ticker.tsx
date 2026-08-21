"use client";

import { useEffect, useState } from "react";
import { POLL_MS } from "@/lib/constants";

export type TickerStats = {
  live: number;
  last12h: number;
  sinceLaunch: number;
  revenueSol: number;
};

export function readTickerStats(data: unknown): TickerStats | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  if (rec.ok !== true) return null;
  const visitors =
    rec.visitors && typeof rec.visitors === "object"
      ? (rec.visitors as Record<string, unknown>)
      : {};
  const live = rec.live ?? visitors.live;
  const last12h = rec.last12h ?? visitors.last12h;
  const sinceLaunch = rec.sinceLaunch ?? visitors.sinceLaunch;
  const revenueSol =
    rec.revenueSol ??
    (typeof rec.revenueUnits === "number" ? rec.revenueUnits / 100 : undefined);
  const hasStats =
    typeof live === "number" ||
    typeof last12h === "number" ||
    typeof sinceLaunch === "number" ||
    typeof revenueSol === "number";
  if (!hasStats) return null;
  return {
    live: typeof live === "number" ? live : 0,
    last12h: typeof last12h === "number" ? last12h : 0,
    sinceLaunch: typeof sinceLaunch === "number" ? sinceLaunch : 0,
    revenueSol: typeof revenueSol === "number" ? revenueSol : 0,
  };
}

export function Ticker({ initial }: { initial: TickerStats }) {
  const [s, setS] = useState<TickerStats>(initial);

  useEffect(() => {
    let dead = false;
    async function tick() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const data = await res.json();
        if (dead) return;
        if (!res.ok) return;
        const next = readTickerStats(data);
        if (!next) return;
        setS(next);
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
