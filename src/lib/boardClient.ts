import type { RankedListing } from "./types";

export type BoardStateBody = {
  ok?: boolean;
  error?: string;
  listings?: RankedListing[];
  activity?: unknown[];
};

export function isHealthyBoardState(
  resOk: boolean,
  data: unknown
): data is BoardStateBody & { ok: true } {
  if (!resOk) return false;
  if (!data || typeof data !== "object") return false;
  const body = data as BoardStateBody;
  return body.ok === true;
}

export function applyBoardState(opts: {
  prevListings: RankedListing[];
  prevReady: boolean;
  resOk: boolean;
  data: unknown;
}): { listings: RankedListing[]; boardReady: boolean; applied: boolean } {
  if (!isHealthyBoardState(opts.resOk, opts.data)) {
    return {
      listings: opts.prevListings,
      boardReady: opts.prevReady,
      applied: false,
    };
  }
  const listings = Array.isArray(opts.data.listings) ? opts.data.listings : [];
  return { listings, boardReady: true, applied: true };
}

export type ClientBidPlan =
  | { canPay: false; reason: "board-not-ready" | "no-identity" }
  | { canPay: true; isRaise: boolean; payUnits: number };

export function clientBidPlan(opts: {
  boardReady: boolean;
  listings: Array<{ identity: string; bidUnits: number }>;
  identity?: string;
  bidUnits: number;
}): ClientBidPlan {
  if (!opts.boardReady) return { canPay: false, reason: "board-not-ready" };
  if (!opts.identity) return { canPay: false, reason: "no-identity" };
  const existing = opts.listings.find((l) => l.identity === opts.identity);
  if (existing) {
    return {
      canPay: true,
      isRaise: true,
      payUnits: Math.max(0, opts.bidUnits - existing.bidUnits),
    };
  }
  return { canPay: true, isRaise: false, payUnits: opts.bidUnits };
}

export function apeEnabled(opts: {
  boardReady: boolean;
  pendingSig: string | null;
  busy?: boolean;
}): boolean {
  return opts.boardReady && !opts.pendingSig && !opts.busy;
}
