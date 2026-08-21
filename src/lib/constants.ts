export const MIN_SOL = 0.05;
export const STEP_SOL = 0.01;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const POLL_MS = 5000;

export const TREASURY_ADDRESS =
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS || "";

export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  "https://api.mainnet-beta.solana.com";

export function toLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export function roundSol(sol: number): number {
  return Math.round(sol * 100) / 100;
}

export function isValidBidAmount(sol: number): boolean {
  if (!Number.isFinite(sol)) return false;
  const cents = Math.round(sol * 100);
  if (Math.abs(sol * 100 - cents) > 1e-6) return false;
  return cents >= Math.round(MIN_SOL * 100);
}

export function shortenCa(ca: string): string {
  if (ca.length <= 10) return ca;
  return `${ca.slice(0, 4)}…${ca.slice(-4)}`;
}

export function formatSol(sol: number): string {
  return `${sol.toFixed(2)} SOL`;
}
