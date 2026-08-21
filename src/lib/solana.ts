import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { signatureLandedOk, type SignatureStatusLike } from "./bidConfirm";
import { TREASURY_ADDRESS } from "./constants";
import { serverRpcCandidates, serverRpcUrl } from "./rpc";
import {
  BID_MAX_AGE_SECONDS,
  isMemoProgramId,
  memoMatchesMint,
} from "./memo";
import {
  fetchSolscanTransfer,
  inspectExplorerTransfer,
  type ExplorerTransfer,
} from "./solscan";
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

export function hasInspectableParsedTx(
  tx: ParsedTxLike | null | undefined
): boolean {
  if (!tx) return false;
  if (extractMemos(tx).length > 0) return true;
  const ixs = tx.transaction?.message?.instructions ?? [];
  return ixs.some((ix) => {
    if (!ix.parsed || typeof ix.parsed !== "object") return false;
    return (ix.parsed as { type?: string }).type === "transfer";
  });
}

export function inspectTransfer(
  tx: ParsedTxLike | null | undefined,
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

export type VerifyResult =
  | { ok: true; canonicalSignature?: string }
  | { ok: false; error: string };

export function isDefinitiveVerifyFailure(
  result: VerifyResult
): result is { ok: false; error: string } {
  if (result.ok) return false;
  return /failed on-chain|too old|Amount mismatch|memo does not match|memo is missing|Treasury address|time is unavailable/.test(
    result.error
  );
}

export function decideTransferVerification(opts: {
  status: SignatureStatusLike;
  tx: ParsedTxLike | null;
  payUnits: number;
  mint: string;
  nowSec?: number;
  treasury?: string;
  explorer?: ExplorerTransfer | null;
}): VerifyResult {
  if (opts.status?.err) {
    return { ok: false, error: "Transaction failed on-chain." };
  }

  const tx = opts.tx;
  if (hasInspectableParsedTx(tx)) {
    return inspectTransfer(tx, opts.payUnits, opts.mint, {
      nowSec: opts.nowSec,
      treasury: opts.treasury,
    });
  }

  if (tx?.meta?.err) {
    return { ok: false, error: "Transaction failed on-chain." };
  }

  if (opts.explorer) {
    const explorer = inspectExplorerTransfer(opts.explorer, opts.payUnits, opts.mint, {
      nowSec: opts.nowSec,
    });
    if (explorer.ok || isDefinitiveVerifyFailure(explorer)) return explorer;
  }

  if (tx?.blockTime != null && Number.isFinite(tx.blockTime)) {
    const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
    if (nowSec - tx.blockTime > BID_MAX_AGE_SECONDS) {
      return { ok: false, error: "Transaction is too old." };
    }
  }

  return { ok: false, error: "Transaction not found / not confirmed yet." };
}

export type TreasurySigInfo = {
  signature: string;
  err: unknown;
  confirmationStatus?: string | null;
  blockTime?: number | null;
  memo?: string | null;
  slot?: number;
};

export function signaturesMatch(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

export function usedSignatureExists(
  used: string[] | undefined,
  sig: string
): boolean {
  return (used ?? []).some((s) => signaturesMatch(s, sig));
}

export function parseHistoryMemo(memo: string | null | undefined): string | null {
  if (!memo) return null;
  const trimmed = memo.trim();
  const prefixed = trimmed.match(/^\[\d+\]\s*([\s\S]+)$/);
  return (prefixed ? prefixed[1] : trimmed).trim() || null;
}

export function findTreasurySignature(
  entries: Array<{
    signature?: string;
    err?: unknown;
    confirmationStatus?: string | null;
    blockTime?: number | null;
    memo?: string | null;
    slot?: number;
  }>,
  submitted: string
): TreasurySigInfo | null {
  for (const row of entries) {
    if (!row.signature || !signaturesMatch(row.signature, submitted)) continue;
    return {
      signature: row.signature,
      err: row.err ?? null,
      confirmationStatus: row.confirmationStatus,
      blockTime: row.blockTime,
      memo: parseHistoryMemo(row.memo),
      slot: row.slot,
    };
  }
  return null;
}

type JsonRpcResult<T> = { result?: T; error?: { message?: string } };

async function rpcCall<T>(
  url: string,
  method: string,
  params: unknown[]
): Promise<T | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await res.json()) as JsonRpcResult<T>;
  if (!res.ok || json.error) return null;
  return json.result ?? null;
}

async function fetchSignatureStatusFromRpc(
  url: string,
  signature: string
): Promise<SignatureStatusLike> {
  const result = await rpcCall<{ value?: SignatureStatusLike[] }>(
    url,
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }]
  );
  return result?.value?.[0] ?? null;
}

async function fetchParsedTxFromRpc(
  url: string,
  signature: string
): Promise<ParsedTxLike | null> {
  const parsed = await rpcCall<ParsedTxLike>(url, "getTransaction", [
    signature,
    {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  if (parsed) return parsed;
  try {
    const connection = new Connection(url, "confirmed");
    const tx = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx as ParsedTxLike;
  } catch {
    /* fall through */
  }
  return null;
}

async function fetchParsedTxWithRetry(
  url: string,
  signature: string,
  attempts = 3
): Promise<ParsedTxLike | null> {
  for (let i = 0; i < attempts; i += 1) {
    const tx = await fetchParsedTxFromRpc(url, signature);
    if (tx) return tx;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  return null;
}

type TreasuryHistoryRow = {
  signature?: string;
  err?: unknown;
  confirmationStatus?: string | null;
  blockTime?: number | null;
  memo?: string | null;
  slot?: number;
};

async function fetchTreasuryHistoryFromRpc(
  url: string
): Promise<TreasuryHistoryRow[]> {
  const result = await rpcCall<TreasuryHistoryRow[]>(
    url,
    "getSignaturesForAddress",
    [treasuryAddress(), { limit: 100 }]
  );
  return result ?? [];
}

async function probeSignature(
  signature: string,
  payUnits: number,
  mint: string
): Promise<{
  landedStatus: SignatureStatusLike;
  lastTx: ParsedTxLike | null;
  decided: VerifyResult;
}> {
  let landedStatus: SignatureStatusLike = null;
  let lastTx: ParsedTxLike | null = null;

  for (const url of serverRpcCandidates()) {
    try {
      const status = await fetchSignatureStatusFromRpc(url, signature);
      if (status?.err) {
        return {
          landedStatus: status,
          lastTx,
          decided: { ok: false, error: "Transaction failed on-chain." },
        };
      }
      if (signatureLandedOk(status)) landedStatus = status;
    } catch {
      /* try parsed + other hosts */
    }

    try {
      const tx = await fetchParsedTxWithRetry(url, signature);
      if (tx) {
        lastTx = tx;
        const check = decideTransferVerification({
          status: landedStatus,
          tx,
          payUnits,
          mint,
        });
        if (check.ok || hasInspectableParsedTx(tx)) {
          return { landedStatus, lastTx, decided: check };
        }
      }
    } catch {
      /* next host */
    }
  }

  return {
    landedStatus,
    lastTx,
    decided: decideTransferVerification({
      status: landedStatus,
      tx: lastTx,
      payUnits,
      mint,
    }),
  };
}

async function resolveTreasurySignature(
  submitted: string
): Promise<TreasurySigInfo | null> {
  for (const url of serverRpcCandidates()) {
    try {
      const entries = await fetchTreasuryHistoryFromRpc(url);
      const found = findTreasurySignature(entries, submitted);
      if (found) return found;
    } catch {
      /* next host */
    }
  }
  return null;
}

export async function verifyTransfer(
  signature: string,
  payUnits: number,
  mint: string
): Promise<VerifyResult> {
  const first = await probeSignature(signature, payUnits, mint);
  if (first.decided.ok || isDefinitiveVerifyFailure(first.decided)) {
    return first.decided;
  }

  let landedStatus = first.landedStatus;
  let lastTx = first.lastTx;
  let canonical = signature;

  const resolved = await resolveTreasurySignature(signature);
  if (resolved?.err) {
    return { ok: false, error: "Transaction failed on-chain." };
  }
  if (resolved) {
    canonical = resolved.signature;
    if (!landedStatus && !resolved.err) {
      landedStatus = {
        err: resolved.err,
        confirmationStatus: resolved.confirmationStatus,
      };
    }
    if (resolved.signature !== signature) {
      const second = await probeSignature(resolved.signature, payUnits, mint);
      if (second.lastTx) lastTx = second.lastTx;
      if (signatureLandedOk(second.landedStatus)) landedStatus = second.landedStatus;
      if (second.decided.ok) {
        return { ...second.decided, canonicalSignature: resolved.signature };
      }
      if (isDefinitiveVerifyFailure(second.decided)) return second.decided;
    }
  }

  let explorer: ExplorerTransfer | null = null;
  try {
    explorer = await fetchSolscanTransfer(canonical, treasuryAddress());
    if (!explorer && canonical !== signature) {
      explorer = await fetchSolscanTransfer(signature, treasuryAddress());
    }
  } catch {
    explorer = null;
  }

  const decided = decideTransferVerification({
    status: landedStatus,
    tx: lastTx,
    explorer,
    payUnits,
    mint,
  });
  if (decided.ok) {
    return canonical !== signature
      ? { ok: true, canonicalSignature: canonical }
      : decided;
  }
  return decided;
}

export function expectedLamports(payUnits: number): number {
  return unitsToLamports(payUnits);
}
