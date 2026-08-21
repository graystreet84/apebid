import { Connection, PublicKey } from "@solana/web3.js";
import { toLamports, SOLANA_RPC, TREASURY_ADDRESS } from "./constants";
import { unitsToLamports } from "./types";

export function fakeTxEnabled(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
    return false;
  }
  if (process.env.VERCEL === "1" && process.env.NODE_ENV === "production") {
    return false;
  }
  return process.env.DEV_FAKE_TX === "true";
}

export function fakeTxAllowed(): boolean {
  return fakeTxEnabled();
}

export function treasuryAddress(): string {
  const a = TREASURY_ADDRESS || process.env.NEXT_PUBLIC_TREASURY_ADDRESS || "";
  if (!a) throw new Error("NEXT_PUBLIC_TREASURY_ADDRESS is missing");
  return a;
}

export function rpcUrl(): string {
  return SOLANA_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
}

export async function verifyTransfer(
  signature: string,
  expected: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const connection = new Connection(rpcUrl(), "confirmed");
  let tx;
  try {
    tx = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    return { ok: false, error: "Could not fetch the transaction from RPC." };
  }
  if (!tx || !tx.meta) {
    return { ok: false, error: "Transaction not found / not confirmed yet." };
  }
  if (tx.meta.err) {
    return { ok: false, error: "Transaction failed on-chain." };
  }

  let treasury: PublicKey;
  try {
    treasury = new PublicKey(treasuryAddress());
  } catch {
    return { ok: false, error: "Treasury address is invalid." };
  }

  // expected may be SOL (0.05+) or units (5+)
  const needed = expected >= 1 && expected === Math.round(expected) && expected < 50
    ? unitsToLamports(expected)
    : expected >= 1
      ? unitsToLamports(Math.round(expected * 100))
      : toLamports(expected);

  let seen = 0;
  for (const ix of tx.transaction.message.instructions) {
    if (!("parsed" in ix) || !ix.parsed) continue;
    const parsed = ix.parsed as {
      type?: string;
      info?: { destination?: string; lamports?: number };
    };
    if (parsed.type !== "transfer") continue;
    if (parsed.info?.destination === treasury.toBase58()) {
      seen += parsed.info.lamports ?? 0;
    }
  }
  if (seen === 0) {
    const keys = tx.transaction.message.accountKeys.map((k) =>
      typeof k === "string" ? k : k.pubkey.toBase58()
    );
    const idx = keys.findIndex((k) => k === treasury.toBase58());
    if (idx >= 0) {
      seen = (tx.meta.postBalances[idx] ?? 0) - (tx.meta.preBalances[idx] ?? 0);
    }
  }
  if (seen < needed) {
    return {
      ok: false,
      error: `Amount mismatch: treasury gained ${seen} lamports, expected ${needed}.`,
    };
  }
  return { ok: true };
}

export function expectedLamports(payUnits: number): number {
  return unitsToLamports(payUnits);
}
