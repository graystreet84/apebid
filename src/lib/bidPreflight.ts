import { ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import { formatSol } from "./types";

/** Modest priority fee — enough to land, not a fee auction. */
export const BID_CU_LIMIT = 40_000;
export const BID_CU_PRICE_MICRO_LAMPORTS = 25_000;
export const BID_PRIORITY_FEE_LAMPORTS = Math.ceil(
  (BID_CU_PRICE_MICRO_LAMPORTS * BID_CU_LIMIT) / 1_000_000
);

/** Conservative 1-sig transfer+memo+priority fee when getFeeForMessage is unavailable. */
export const DEFAULT_TX_FEE_LAMPORTS = 5_000 + BID_PRIORITY_FEE_LAMPORTS + 5_000;

export function bidComputeBudgetIxs(): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: BID_CU_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: BID_CU_PRICE_MICRO_LAMPORTS,
    }),
  ];
}

export function walletNeedsSolMessage(payUnits: number): string {
  return `this wallet needs ${formatSol(payUnits)} SOL + fee`;
}

export function walletCoversBid(
  lamports: number,
  bidLamports: number,
  feeLamports = DEFAULT_TX_FEE_LAMPORTS
): boolean {
  return lamports >= bidLamports + feeLamports;
}

export function simulateTransactionRpcParams(encodedBase64: string) {
  return [
    encodedBase64,
    {
      encoding: "base64",
      sigVerify: false,
      commitment: "confirmed",
    },
  ] as const;
}

export async function simulateUnsignedTransaction(
  encodedBase64: string
): Promise<{ err: unknown; logs?: string[] | null }> {
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: simulateTransactionRpcParams(encodedBase64),
    }),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    result?: { value?: { err: unknown; logs?: string[] | null } };
  };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `simulation failed (${res.status})`);
  }
  const value = json.result?.value;
  if (!value) throw new Error("simulation returned no result");
  return value;
}

export function formatSimulateError(
  err: unknown,
  logs?: (string | undefined)[] | null
): string {
  let text: string;
  if (typeof err === "string") text = err;
  else if (err instanceof Error) text = err.message;
  else {
    try {
      text = JSON.stringify(err);
    } catch {
      text = "simulation failed";
    }
  }
  const useful = (logs || []).filter((l): l is string => Boolean(l));
  const hint =
    useful.find((l) => /insufficient|not enough|failed/i.test(l)) ||
    useful[useful.length - 1];
  if (hint && !text.includes(hint)) return `${text} — ${hint}`;
  return text;
}
