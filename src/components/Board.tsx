"use client";

import { useState } from "react";
import { formatSol, unitsToSol, type RankedListing } from "@/lib/types";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function claimRank(row: RankedListing) {
  const next = unitsToSol(row.bidUnits) + 0.01;
  window.dispatchEvent(
    new CustomEvent("apebid-claim", { detail: Math.round(next * 100) / 100 })
  );
  document.getElementById("bid-form")?.scrollIntoView({ behavior: "smooth" });
}

function TokenThumb({
  src,
  ticker,
  size,
}: {
  src?: string | null;
  ticker: string;
  size: number;
}) {
  const [broken, setBroken] = useState(false);
  const letter = (ticker || "?").charAt(0).toUpperCase() || "?";
  if (!src || broken) {
    return (
      <div
        className="flex shrink-0 items-center justify-center border-2 border-black bg-hot font-smash leading-none text-black"
        style={{ width: size, height: size, fontSize: Math.max(12, size * 0.48) }}
        aria-hidden
      >
        {letter}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 border-2 border-black bg-black object-cover"
      style={{ width: size, height: size }}
      onError={() => setBroken(true)}
    />
  );
}

function tokenLabel(row: RankedListing): string {
  return row.ticker || row.name || `${row.mint.slice(0, 4)}…${row.mint.slice(-4)}`;
}

function PromoCard({ row }: { row: RankedListing }) {
  const label = tokenLabel(row);
  const dest = row.clickUrl.includes("pump.fun") ? "pump.fun" : "solscan";
  return (
    <div className="mb-5">
      <a
        href={`/api/click/${row.id}`}
        target="_blank"
        rel="noreferrer"
        className="block no-underline"
      >
        <div className="ugly-focus p-3 text-black sm:p-4">
          <div className="flex items-start gap-3">
            <TokenThumb src={row.imageUrl} ticker={label} size={72} />
            <div className="min-w-0 flex-1">
              <div className="font-smash text-4xl leading-none text-hot sm:text-5xl">
                #1
              </div>
              <div className="font-smash text-2xl uppercase leading-none sm:text-3xl">
                {label}
              </div>
              {row.name && row.name !== row.ticker ? (
                <div className="text-sm font-bold sm:text-base">{row.name}</div>
              ) : null}
              <div className="mt-1 font-smash text-xl sm:text-2xl">
                {formatSol(row.bidUnits)} SOL
              </div>
              {row.tagline ? (
                <div className="text-sm font-bold">{row.tagline}</div>
              ) : null}
              <div className="mt-1 text-[10px] font-bold uppercase text-black/70">
                whole card is the click-out → {dest}
              </div>
            </div>
            <div className="shrink-0 pt-1 text-right">
              <div className="font-smash text-xl leading-none text-hot sm:text-2xl">
                {row.clicks}
              </div>
              <div className="text-[10px] font-smash tracking-wide text-black/70">
                CLICKS
              </div>
            </div>
          </div>
        </div>
      </a>
      <button
        type="button"
        className="mt-2 border-2 border-black bg-hot px-3 py-1 font-smash text-sm text-black"
        onClick={() => claimRank(row)}
      >
        claim #1 for {formatSol(row.bidUnits + 1)} SOL
      </button>
    </div>
  );
}

export function Board({ listings }: { listings: RankedListing[] }) {
  const top = listings[0];
  const rest = listings.slice(1);

  if (listings.length === 0) {
    return (
      <p className="text-center text-sm text-white/50">
        empty board. be the first ape.
      </p>
    );
  }

  return (
    <section className="ugly-box-acid p-3 sm:p-4">
      <h2 className="font-smash text-xl text-acid sm:text-2xl">THE BOARD</h2>
      <p className="mb-3 text-xs text-white/55">
        click-out counts. no swap. pump.fun or solscan.
      </p>
      {top ? <PromoCard row={top} /> : null}
      {rest.length > 0 ? (
        <ul className="divide-y divide-white/15">
          {rest.map((row) => (
            <li
              key={row.id}
              className={
                row.rank % 2 === 0
                  ? "bg-[#1a0014] px-1 py-3"
                  : "bg-black px-1 py-3"
              }
            >
              <div className="flex items-start gap-3">
                <div className="w-8 shrink-0 font-smash text-2xl leading-none text-yell">
                  {row.rank}
                </div>
                <TokenThumb
                  src={row.imageUrl}
                  ticker={tokenLabel(row)}
                  size={36}
                />
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/click/${row.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold"
                  >
                    {tokenLabel(row)}
                  </a>
                  <div className="text-[10px] text-white/40">
                    {row.clickUrl.includes("pump.fun")
                      ? "pump.fun"
                      : "solscan"}
                  </div>
                  {row.tagline ? (
                    <div className="mt-0.5 text-xs text-white/70">
                      {row.tagline}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="mt-1 block text-xs text-hot underline"
                    onClick={() => claimRank(row)}
                  >
                    claim this rank for {formatSol(row.bidUnits + 1)} SOL
                  </button>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-bold text-acid">
                    {formatSol(row.bidUnits)} SOL
                  </div>
                  <div className="text-xs text-white/50">
                    {row.clicks} clicks
                  </div>
                  <div className="text-[10px] text-white/40">
                    {timeAgo(row.updatedAt)}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
