import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { TREASURY_ADDRESS } from "./constants";
import { serverRpcUrl } from "./rpc";
import {
  BID_MAX_AGE_SECONDS,
  isMemoProgramId,
  memoMatchesMint,
} from "./memo";
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
  return serverRpcUrl();
}

export type ParsedIxLike = {
  program?: string;
  programId?: string | { toBase58(): string };
  parsed?: unknown;
  data?: string;
};

export type ParsedTxLike = {
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    preBalances?: number[];
    postBalances?: number[];
    innerInstructions?: { instructions?: ParsedIxLike[] }[];
  } | null;
  transaction: {
    message: {
      instructions: ParsedIxLike[];
      accountKeys?: (string | { pubkey: { toBase58(): string } })[];
    };
  };
};

function programIdOf(ix: ParsedIxLike): string {
  if (typeof ix.programId === "string") return ix.programId;
  if (ix.programId && typeof ix.programId.toBase58 === "function") {
    return ix.programId.toBase58();
  }
  return "";
}

function decodeIxData(data: string): string | null {
  try {
    return Buffer.from(bs58.decode(data)).toString("utf8");
  } catch {
    try {
      return Buffer.from(data, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
}

function memoFromIx(ix: ParsedIxLike): string[] {
  const out: string[] = [];
  if (typeof ix.parsed === "string" && ix.parsed) {
    out.push(ix.parsed);
  } else if (ix.parsed && typeof ix.parsed === "object") {
    const parsed = ix.parsed as { memo?: string; info?: { memo?: string } };
    if (typeof parsed.memo === "string" && parsed.memo) out.push(parsed.memo);
    if (typeof parsed.info?.memo === "string" && parsed.info.memo) {
      out.push(parsed.info.memo);
    }
  }
  const pid = programIdOf(ix);
  const isMemo = ix.program === "spl-memo" || isMemoProgramId(pid);
  if (isMemo && typeof ix.data === "string" && ix.data) {
    const decoded = decodeIxData(ix.data);
    if (decoded) out.push(decoded);
  }
  return out;
}

export function extractMemos(tx: ParsedTxLike): string[] {
  const memos: string[] = [];
  const top = tx.transaction?.message?.instructions ?? [];
  for (const ix of top) memos.push(...memoFromIx(ix));
  const inner = tx.meta?.innerInstructions ?? [];
  for (const group of inner) {
    for (const ix of group.instructions ?? []) memos.push(...memoFromIx(ix));
  }
  return memos;
}

function treasuryGainLamports(tx: ParsedTxLike, treasury: string): number {
  let seen = 0;
  const ixs = tx.transaction?.message?.instructions ?? [];
  for (const ix of ixs) {
    if (!ix.parsed || typeof ix.parsed !== "object") continue;
    const parsed = ix.parsed as {
      type?: string;
      info?: { destination?: string; lamports?: number };
    };
    if (parsed.type !== "transfer") continue;
    if (parsed.info?.destination === treasury) {
      seen += parsed.info.lamports ?? 0;
    }
  }
  if (seen > 0) return seen;
  const keys = (tx.transaction.message.accountKeys ?? []).map((k) =>
    typeof k === "string" ? k : k.pubkey.toBase58()
  );
  const idx = keys.findIndex((k) => k === treasury);
  if (idx >= 0 && tx.meta) {
    return (tx.meta.postBalances?.[idx] ?? 0) - (tx.meta.preBalances?.[idx] ?? 0);
  }
  return 0;
}

export function inspectTransfer(
  tx: ParsedTxLike,
  payUnits: number,
  mint: string,
  opts?: { nowSec?: number; treasury?: string }
): { ok: true } | { ok: false; error: string } {
  if (!tx || !tx.meta) {
    return { ok: false, error: "Transaction not found / not confirmed yet." };
  }
  if (tx.meta.err) {
    return { ok: false, error: "Transaction failed on-chain." };
  }

  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  if (tx.blockTime == null || !Number.isFinite(tx.blockTime)) {
    return { ok: false, error: "Transaction time is unavailable." };
  }
  if (nowSec - tx.blockTime > BID_MAX_AGE_SECONDS) {
    return { ok: false, error: "Transaction is too old." };
  }

  const memos = extractMemos(tx);
  if (!memos.length) {
    return { ok: false, error: "Payment memo is missing." };
  }
  if (!memos.some((m) => memoMatchesMint(m, mint))) {
    return { ok: false, error: "Payment memo does not match this listing." };
  }

  let treasury: string;
  try {
    treasury = new PublicKey(opts?.treasury || treasuryAddress()).toBase58();
  } catch {
    return { ok: false, error: "Treasury address is invalid." };
  }

  const needed = unitsToLamports(payUnits);
  const seen = treasuryGainLamports(tx, treasury);
  if (seen < needed) {
    return {
      ok: false,
      error: `Amount mismatch: treasury gained ${seen} lamports, expected ${needed}.`,
    };
  }
  return { ok: true };
}

export async function verifyTransfer(
  signature: string,
  payUnits: number,
  mint: string
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
  return inspectTransfer(tx as ParsedTxLike, payUnits, mint);
}

export function expectedLamports(payUnits: number): number {
  return unitsToLamports(payUnits);
}
