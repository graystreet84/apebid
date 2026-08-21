import type { Listing, RankedListing } from "./types";
import { listingUnits } from "./types";

function decorate(row: Listing, rank: number): RankedListing {
  const units = listingUnits(row);
  return {
    ...row,
    rank,
    bidUnits: units,
    bidSol: units / 100,
    display: row.display || row.ticker || row.name || row.identity,
    identityType:
      row.identityType ||
      (row.clickUrl?.includes("pump.fun") || row.url?.includes("pump.fun")
        ? "pump"
        : "ca"),
    url: row.url || row.clickUrl,
    clickUrl: row.clickUrl || row.url || "",
  };
}

export function rankListings(listings: Listing[]): RankedListing[] {
  const sorted = [...listings].sort((a, b) => {
    const bu = listingUnits(b);
    const au = listingUnits(a);
    if (bu !== au) return bu - au;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  return sorted.map((row, i) => decorate(row, i + 1));
}

export function previewRank(
  listings: Listing[],
  bidUnits: number,
  identity?: string
): number {
  const others = identity
    ? listings.filter((l) => l.identity !== identity)
    : listings;
  let better = 0;
  for (const row of others) {
    const u = listingUnits(row);
    if (u > bidUnits) better += 1;
    else if (u === bidUnits) better += 1;
  }
  return better + 1;
}

export function claimPriceForRank(listings: Listing[], rank: number): number {
  const ranked = rankListings(listings);
  const target = ranked.find((r) => r.rank === rank);
  if (!target) return 5;
  return listingUnits(target) + 1;
}
