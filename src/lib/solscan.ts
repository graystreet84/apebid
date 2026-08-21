import { BID_MAX_AGE_SECONDS, memoMatchesMint } from "./memo";
import { unitsToLamports } from "./types";

export type ExplorerTransfer = {
  success: boolean;
  blockTime: number | null;
  treasuryLamports: number;
  memos: string[];
  signature?: string;
};

const SOLSCAN_ENDPOINTS = (signature: string) => [
  `https://public-api.solscan.io/transaction/${signature}`,
  `https://public-api.solscan.io/transaction?tx=${signature}`,
  `https://api-v2.solscan.io/v2/transaction/detail?tx=${signature}`,
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function collectStrings(value: unknown, into: string[], depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    if (value.trim()) into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into, depth + 1);
    return;
  }
  const rec = asRecord(value);
  if (!rec) return;
  for (const key of ["memo", "message", "data", "parsed"]) {
    if (key in rec) collectStrings(rec[key], into, depth + 1);
  }
}

function looksFailed(value: unknown): boolean {
  const rec = asRecord(value);
  if (!rec) return false;
  if (rec.err != null && rec.err !== false && rec.err !== "null") return true;
  const status = str(rec.status) || str(rec.txStatus) || str(rec.tx_status);
  if (status && /fail|error|dropped/i.test(status)) return true;
  if (rec.success === false) return true;
  return looksFailed(rec.data) || looksFailed(rec.result);
}

function looksSuccess(value: unknown): boolean {
  const rec = asRecord(value);
  if (!rec) return false;
  const status = str(rec.status) || str(rec.txStatus) || str(rec.tx_status);
  if (status && /^success$/i.test(status)) return true;
  if (rec.success === true && !looksFailed(rec)) return true;
  if (rec.status === 1 || rec.status === "1") return true;
  const nested = asRecord(rec.data) || asRecord(rec.result);
  return nested ? looksSuccess(nested) : false;
}

function addressOf(value: unknown): string | null {
  const direct = str(value);
  if (direct) return direct;
  const rec = asRecord(value);
  if (!rec) return null;
  return (
    str(rec.address) ||
    str(rec.pubkey) ||
    str(rec.destination) ||
    str(rec.destination_owner) ||
    str(rec.dst) ||
    str(rec.to) ||
    str(rec.owner) ||
    null
  );
}

function lamportsToTreasury(value: unknown, treasury: string, depth = 0): number {
  if (depth > 7 || value == null) return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + lamportsToTreasury(item, treasury, depth + 1), 0);
  }
  const rec = asRecord(value);
  if (!rec) return 0;

  let seen = 0;
  const dest =
    str(rec.destination) ||
    str(rec.destination_owner) ||
    str(rec.dst) ||
    str(rec.to) ||
    str(rec.address) ||
    str(rec.owner);
  const amount =
    num(rec.lamports) ??
    num(rec.amount) ??
    num(rec.change_amount) ??
    num(rec.changeAmount) ??
    num(rec.value);
  if (dest === treasury && amount != null && amount > 0) {
    const decimals = num(rec.decimals);
    seen += decimals === 9 || decimals == null ? amount : 0;
  }

  const pre = num(rec.pre_balance) ?? num(rec.preBalance) ?? num(rec.pre);
  const post = num(rec.post_balance) ?? num(rec.postBalance) ?? num(rec.post);
  const addr = addressOf(rec);
  if (addr === treasury && pre != null && post != null && post - pre > 0) {
    seen = Math.max(seen, post - pre);
  }

  for (const key of [
    "solTransfers",
    "sol_transfers",
    "transfers",
    "sol_bal_change",
    "solBalChange",
    "tokenTransfers",
    "parsedInstruction",
    "parsed_instructions",
    "data",
    "result",
  ]) {
    if (key in rec) seen = Math.max(seen, lamportsToTreasury(rec[key], treasury, depth + 1));
  }
  return seen;
}

function collectMemos(value: unknown): string[] {
  const memos: string[] = [];
  const rec = asRecord(value);
  if (!rec) return memos;
  collectStrings(rec.memo, memos);
  collectStrings(rec.memos, memos);
  const parsed = asArray(rec.parsedInstruction).concat(asArray(rec.parsed_instructions));
  for (const ix of parsed) {
    const row = asRecord(ix);
    if (!row) continue;
    const program = str(row.program) || str(row.programId) || "";
    if (/memo/i.test(program) || row.type === "memo") {
      collectStrings(row, memos);
    }
  }
  const nested = asRecord(rec.data) || asRecord(rec.result);
  if (nested) memos.push(...collectMemos(nested));
  return [...new Set(memos.map((m) => m.trim()).filter(Boolean))];
}

function blockTimeOf(value: unknown): number | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const direct =
    num(rec.blockTime) ??
    num(rec.block_time) ??
    num(rec.timestamp) ??
    num(rec.blocktime);
  if (direct != null) return direct > 1e12 ? Math.floor(direct / 1000) : direct;
  const nested = asRecord(rec.data) || asRecord(rec.result);
  return nested ? blockTimeOf(nested) : null;
}

export function parseSolscanPayload(
  json: unknown,
  treasury: string
): ExplorerTransfer | null {
  if (!json || typeof json !== "object") return null;
  if (looksFailed(json)) {
    return {
      success: false,
      blockTime: blockTimeOf(json),
      treasuryLamports: 0,
      memos: collectMemos(json),
    };
  }
  if (!looksSuccess(json)) return null;
  return {
    success: true,
    blockTime: blockTimeOf(json),
    treasuryLamports: lamportsToTreasury(json, treasury),
    memos: collectMemos(json),
    signature: str(asRecord(json)?.txHash) || str(asRecord(asRecord(json)?.data)?.txHash) || undefined,
  };
}

export function inspectExplorerTransfer(
  ex: ExplorerTransfer | null | undefined,
  payUnits: number,
  mint: string,
  opts?: { nowSec?: number }
): { ok: true } | { ok: false; error: string } {
  if (!ex) {
    return { ok: false, error: "Transaction not found / not confirmed yet." };
  }
  if (!ex.success) {
    return { ok: false, error: "Transaction failed on-chain." };
  }

  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  if (ex.blockTime == null || !Number.isFinite(ex.blockTime)) {
    return { ok: false, error: "Transaction time is unavailable." };
  }
  if (nowSec - ex.blockTime > BID_MAX_AGE_SECONDS) {
    return { ok: false, error: "Transaction is too old." };
  }

  const needed = unitsToLamports(payUnits);
  if (ex.treasuryLamports > 0 && ex.treasuryLamports < needed) {
    return {
      ok: false,
      error: `Amount mismatch: treasury gained ${ex.treasuryLamports} lamports, expected ${needed}.`,
    };
  }

  if (!ex.memos.length) {
    return { ok: false, error: "Transaction not found / not confirmed yet." };
  }
  if (!ex.memos.some((m) => memoMatchesMint(m, mint))) {
    return { ok: false, error: "Payment memo does not match this listing." };
  }

  if (ex.treasuryLamports <= 0) {
    return { ok: false, error: "Transaction not found / not confirmed yet." };
  }
  return { ok: true };
}

async function fetchJson(url: string, signature: string): Promise<unknown | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (compatible; apebid-verify/1.0; +https://www.apebid.lol)",
    Origin: "https://solscan.io",
    Referer: `https://solscan.io/tx/${signature}`,
  };
  const token = process.env.SOLSCAN_API_KEY?.trim();
  if (token) headers.token = token;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trim().startsWith("<")) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function fetchSolscanTransfer(
  signature: string,
  treasury: string
): Promise<ExplorerTransfer | null> {
  for (const url of SOLSCAN_ENDPOINTS(signature)) {
    const json = await fetchJson(url, signature);
    const parsed = parseSolscanPayload(json, treasury);
    if (parsed) return parsed;
  }

  const token = process.env.SOLSCAN_API_KEY?.trim();
  if (token) {
    const json = await fetchJson(
      `https://pro-api.solscan.io/v2.0/transaction/detail?tx=${signature}`,
      signature
    );
    const parsed = parseSolscanPayload(json, treasury);
    if (parsed) return parsed;
  }
  return null;
}
