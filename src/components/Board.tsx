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
        className="flex shrink-0 items-center justify-center border-4 border-black bg-hot font-smash leading-none text-black"
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
      className="shrink-0 border-4 border-black bg-black object-cover"
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
    <div className="mb-4">
      <a
        href={`/api/click/${row.id}`}
        target="_blank"
        rel="noreferrer"
        className="block no-underline"
      >
        <div className="border-4 border-black bg-yell p-4 text-black shadow-[10px_10px_0_#ff2d95]">
          <div className="flex flex-wrap items-center gap-4">
            <TokenThumb src={row.imageUrl} ticker={label} size={112} />
            <div className="min-w-0 flex-1">
              <div className="font-smash text-5xl leading-none text-hot">#1</div>
              <div className="font-smash text-4xl uppercase leading-none">{label}</div>
              {row.name && row.name !== row.ticker ? (
                <div className="text-lg font-bold">{row.name}</div>
              ) : null}
              <div className="mt-1 font-smash text-2xl">
                {formatSol(row.bidUnits)} SOL
              </div>
              {row.tagline ? <div className="text-sm font-bold">{row.tagline}</div> : null}
              <div className="mt-1 text-xs font-bold uppercase">
                whole card is the click-out → {dest}
              </div>
            </div>
            <div className="min-w-[140px] text-center">
              <div className="font-smash text-7xl leading-none text-hot">{row.clicks}</div>
              <div className="font-smash text-3xl leading-none text-black">CLICKS</div>
            </div>
          </div>
        </div>
      </a>
      <button
        type="button"
        className="mt-3 border-4 border-black bg-hot px-3 py-1 font-smash text-lg text-black"
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

  return (
    <section className="ugly-box-acid overflow-x-auto p-3 sm:p-4">
      <h2 className="font-smash text-2xl text-acid">THE BOARD</h2>
      <p className="mb-3 text-xs text-white/70">
        click-out counts. no swap. pump.fun or solscan.
      </p>
      {listings.length === 0 ? (
        <p className="border-2 border-hot p-4 text-hot">
          empty board. be the first ape.
        </p>
      ) : (
        <>
          {top ? <PromoCard row={top} /> : null}
          {rest.length > 0 ? (
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-hot text-black">
                  <th className="border-2 border-black px-2 py-1">#</th>
                  <th className="border-2 border-black px-2 py-1">token</th>
                  <th className="border-2 border-black px-2 py-1">bid</th>
                  <th className="border-2 border-black px-2 py-1">clicks</th>
                  <th className="border-2 border-black px-2 py-1">when</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      row.rank % 2 === 0 ? "bg-[#1a0014]" : "bg-black"
                    }
                  >
                    <td className="border-2 border-white/30 px-2 py-2 font-smash text-xl text-yell">
                      {row.rank}
                    </td>
                    <td className="border-2 border-white/30 px-2 py-2">
                      <div className="flex items-center gap-2">
                        <TokenThumb
                          src={row.imageUrl}
                          ticker={tokenLabel(row)}
                          size={28}
                        />
                        <div>
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
                        </div>
                      </div>
                    </td>
                    <td className="border-2 border-white/30 px-2 py-2 font-bold text-acid">
                      {formatSol(row.bidUnits)} SOL
                    </td>
                    <td className="border-2 border-white/30 px-2 py-2">
                      <div className="font-smash text-4xl leading-none text-yell">
                        {row.clicks}
                      </div>
                      <div className="font-smash text-sm text-acid">CLICKS</div>
                    </td>
                    <td className="border-2 border-white/30 px-2 py-2 text-white/70">
                      {timeAgo(row.updatedAt)}
                      {row.tagline ? (
                        <div className="mt-1 text-white/80">{row.tagline}</div>
                      ) : null}
                      <button
                        type="button"
                        className="mt-1 block text-hot underline"
                        onClick={() => claimRank(row)}
                      >
                        claim this rank for {formatSol(row.bidUnits + 1)} SOL
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </section>
  );
}
