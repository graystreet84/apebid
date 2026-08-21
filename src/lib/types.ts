export type IdentityType = "ca" | "pump";

export type Listing = {
  id: string;
  identity: string;
  mint: string;
  clickUrl: string;
  ticker: string;
  name: string;
  tagline: string;
  bidUnits: number;
  paidUnits: number;
  createdAt: string;
  updatedAt: string;
  clicks: number;
  identityType?: IdentityType;
  display?: string;
  url?: string;
  bidSol?: number;
  wallet?: string;
  lastTxSig?: string;
  imageUrl?: string | null;
};

export type Activity = {
  id: string;
  listingId: string;
  identity: string;
  ticker: string;
  name: string;
  rank: number;
  bidUnits: number;
  paidUnits: number;
  kind: "new" | "raise";
  createdAt: string;
  type?: "bid" | "raise" | "new";
  display?: string;
  bidSol?: number;
  paidSol?: number;
  at?: string;
};

export type ActivityEvent = Activity;

export type StoreData = {
  listings: Listing[];
  activity: Activity[];
  usedSignatures: string[];
  usedSigs?: string[];
};

export type RankedListing = Listing & { rank: number };

export type VisitorStats = {
  live: number;
  last12h: number;
  sinceLaunch: number;
  launchedAt: string;
};

export type BoardState = {
  listings: RankedListing[];
  activity: Activity[];
  revenueUnits: number;
  revenueSol?: number;
  live?: number;
  last12h?: number;
  sinceLaunch?: number;
  launchedAt?: string;
  visitors?: VisitorStats;
};

export const UNIT = 0.01;
export const MIN_UNITS = 5;
export const STEP_UNITS = 1;
export const LAMPORTS_PER_SOL = 1_000_000_000;

export function unitsToSol(units: number): number {
  return units / 100;
}

export function solToUnits(sol: number): number {
  return Math.round(sol * 100);
}

export function unitsToLamports(units: number): number {
  return units * 10_000_000;
}

export function formatSol(units: number): string {
  return unitsToSol(units).toFixed(2);
}

export function listingUnits(row: { bidUnits?: number; bidSol?: number }): number {
  if (typeof row.bidUnits === "number") return row.bidUnits;
  if (typeof row.bidSol === "number") return Math.round(row.bidSol * 100);
  return 0;
}
