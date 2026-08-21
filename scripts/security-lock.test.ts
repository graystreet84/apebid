import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||=
  "Csx6qmKTzcrSQAVjRRygMQ8RqRJcAPiDNJD5ZnbZyQmt";

import { unitsToLamports } from "../src/lib/types";
import {
  decideTransferVerification,
  fakeTxEnabled,
  findTreasurySignature,
  historyTreasuryLamports,
  inspectTransfer,
  isDefinitiveVerifyFailure,
  parseHistoryMemo,
  signaturesMatch,
  usedSignatureExists,
  type ParsedTxLike,
} from "../src/lib/solana";
import {
  BID_RECORD_RETRY_WINDOW_MS,
  isRetryableRecordError,
  recordBidWithRetry,
} from "../src/lib/bidRecord";
import {
  inspectExplorerTransfer,
  parseSolscanPayload,
} from "../src/lib/solscan";
import { bidMemoData, BID_MAX_AGE_SECONDS, MEMO_PROGRAM_ID } from "../src/lib/memo";
import { isAllowedClickUrl } from "../src/lib/validate";
import { apeEnabled, applyBoardState, clientBidPlan, isHealthyBoardState } from "../src/lib/boardClient";
import { readTickerStats } from "../src/components/Ticker";
import {
  clearPendingBid,
  PENDING_BID_KEY,
  readPendingBid,
  writePendingBid,
} from "../src/lib/pendingBid";
import { httpsImageUrl, isAllowedImageHost } from "../src/lib/tokenImage";
import { canAcceptPaidBid, durableStoreConfigured, emptyStatePayload, hostedStoreConfigured } from "../src/lib/store";
import { neonUrl } from "../src/lib/storeNeon";
import {
  OFFICIAL_RPC,
  PUBLIC_FALLBACK_RPC,
  clientRequestOrigin,
  isAllowedRpcMethod,
  isOfficialRpc,
  isRetryableUpstreamStatus,
  isAllowedSiteOrigin,
  bidBurstLimited,
  isAllowedSiteRequest,
  isSameOriginRequest,
  rpcBurstLimited,
  serverRpcCandidates,
  serverRpcUrl,
} from "../src/lib/rpc";
import { RPC_PROXY_PATH, clientRpcEndpoint } from "../src/lib/constants";
import {
  BID_CU_PRICE_MICRO_LAMPORTS,
  BID_PRIORITY_FEE_LAMPORTS,
  DEFAULT_TX_FEE_LAMPORTS,
  bidComputeBudgetIxs,
  formatSimulateError,
  simulateTransactionRpcParams,
  walletCoversBid,
  walletNeedsSolMessage,
} from "../src/lib/bidPreflight";
import {
  isBlockHeightExceededError,
  shouldPostBid,
  signatureLandedOk,
  waitForSignatureLanded,
} from "../src/lib/bidConfirm";

const TREASURY = "Csx6qmKTzcrSQAVjRRygMQ8RqRJcAPiDNJD5ZnbZyQmt";
const MINT = "So11111111111111111111111111111111111111112";
const OTHER = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

let failed = 0;
let passed = 0;
const pending: { name: string; fn: () => void | Promise<void> }[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  pending.push({ name, fn });
}

function mockTx(opts: {
  lamports: number;
  memo?: string | null;
  blockTime?: number | null;
}): ParsedTxLike {
  const instructions: ParsedTxLike["transaction"]["message"]["instructions"] = [
    {
      programId: "11111111111111111111111111111111",
      parsed: {
        type: "transfer",
        info: { destination: TREASURY, lamports: opts.lamports },
      },
    },
  ];
  if (opts.memo !== null) {
    instructions.push({
      program: "spl-memo",
      programId: MEMO_PROGRAM_ID,
      parsed: opts.memo ?? bidMemoData(MINT),
    });
  }
  const now = Math.floor(Date.now() / 1000);
  return {
    blockTime: opts.blockTime === undefined ? now - 30 : opts.blockTime,
    meta: { err: null, preBalances: [], postBalances: [] },
    transaction: { message: { instructions, accountKeys: [TREASURY] } },
  };
}

test("unitsToLamports 0.05 SOL", () => {
  assert.equal(unitsToLamports(5), 50_000_000);
});

test("unitsToLamports 0.50 SOL", () => {
  assert.equal(unitsToLamports(50), 500_000_000);
});

test("unitsToLamports 1.00 SOL", () => {
  assert.equal(unitsToLamports(100), 1_000_000_000);
});

test("0.50 SOL payUnits is not treated as 50 SOL", () => {
  const tx = mockTx({ lamports: 500_000_000 });
  const check = inspectTransfer(tx, 50, MINT, { treasury: TREASURY });
  assert.equal(check.ok, true);
});

test("wrong expected amount is rejected", () => {
  const tx = mockTx({ lamports: 50_000_000 });
  const check = inspectTransfer(tx, 50, MINT, { treasury: TREASURY });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /Amount mismatch/);
});

test("fake tx disabled when VERCEL_ENV=production", () => {
  const env = process.env as Record<string, string | undefined>;
  const prev = {
    VERCEL_ENV: env.VERCEL_ENV,
    VERCEL: env.VERCEL,
    NODE_ENV: env.NODE_ENV,
    DEV_FAKE_TX: env.DEV_FAKE_TX,
  };
  try {
    env.VERCEL_ENV = "production";
    env.DEV_FAKE_TX = "true";
    assert.equal(fakeTxEnabled(), false);

    env.VERCEL = "1";
    env.VERCEL_ENV = "production";
    env.DEV_FAKE_TX = "true";
    assert.equal(fakeTxEnabled(), false);

    delete env.VERCEL_ENV;
    env.VERCEL = "1";
    env.NODE_ENV = "production";
    env.DEV_FAKE_TX = "true";
    assert.equal(fakeTxEnabled(), false);

    env.VERCEL_ENV = "preview";
    env.VERCEL = "1";
    env.DEV_FAKE_TX = "true";
    assert.equal(fakeTxEnabled(), false);
  } finally {
    restoreEnv(prev);
  }
});

test("memo mismatch is rejected", () => {
  const tx = mockTx({ lamports: 50_000_000, memo: bidMemoData(OTHER) });
  const check = inspectTransfer(tx, 5, MINT, { treasury: TREASURY });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /does not match/);
});

test("missing memo is rejected", () => {
  const tx = mockTx({ lamports: 50_000_000, memo: null });
  const check = inspectTransfer(tx, 5, MINT, { treasury: TREASURY });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /memo is missing/);
});

test("old blockTime is rejected", () => {
  const now = 1_800_000_000;
  const tx = mockTx({
    lamports: 50_000_000,
    blockTime: now - BID_MAX_AGE_SECONDS - 1,
  });
  const check = inspectTransfer(tx, 5, MINT, { nowSec: now, treasury: TREASURY });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /too old/);
});

test("matching recent transfer is accepted", () => {
  const now = 1_800_000_000;
  const tx = mockTx({ lamports: 50_000_000, blockTime: now - 60 });
  const check = inspectTransfer(tx, 5, MINT, { nowSec: now, treasury: TREASURY });
  assert.equal(check.ok, true);
});

test("20-minute-old transfer is accepted within the 1 hour verify window", () => {
  const now = 1_800_000_000;
  const tx = mockTx({ lamports: 50_000_000, blockTime: now - 20 * 60 });
  const check = inspectTransfer(tx, 5, MINT, { nowSec: now, treasury: TREASURY });
  assert.equal(check.ok, true);
  assert.ok(BID_MAX_AGE_SECONDS >= 60 * 60);
});

test("finalized status is rejected when parsed tx is missing", () => {
  const check = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: null,
    payUnits: 5,
    mint: MINT,
    treasury: TREASURY,
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /not found|not confirmed yet/);
});

test("confirmed status is rejected when parsed tx is missing", () => {
  const check = decideTransferVerification({
    status: { err: null, confirmationStatus: "confirmed" },
    tx: null,
    payUnits: 5,
    mint: MINT,
    treasury: TREASURY,
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /not found|not confirmed yet/);
});

test("landed status + no parsed tx + no explorer is not ok", () => {
  const check = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: null,
    explorer: null,
    payUnits: 5,
    mint: MINT,
    treasury: TREASURY,
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /not found|not confirmed yet/);
});

test("missing parsed tx is rejected without a landed status", () => {
  const check = decideTransferVerification({
    status: null,
    tx: null,
    payUnits: 5,
    mint: MINT,
    treasury: TREASURY,
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /not found/);
});

test("finalized status with on-chain err is rejected", () => {
  const check = decideTransferVerification({
    status: { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "finalized" },
    tx: null,
    payUnits: 5,
    mint: MINT,
    treasury: TREASURY,
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /failed on-chain/);
});

test("parsed tx still enforces memo when statuses are finalized", () => {
  const tx = mockTx({ lamports: 50_000_000, memo: bidMemoData(OTHER) });
  const check = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx,
    payUnits: 5,
    mint: MINT,
    treasury: TREASURY,
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /does not match/);
});

test("explorer success + amount ok + empty memos is not ok (retry)", () => {
  const now = 1_800_000_000;
  const parsed = parseSolscanPayload(
    {
      success: true,
      data: {
        txStatus: "Success",
        blockTime: now - 20 * 60,
        solTransfers: [
          { destination: TREASURY, lamports: 50_000_000 },
        ],
      },
    },
    TREASURY
  );
  assert.ok(parsed);
  assert.equal(parsed?.success, true);
  assert.equal(parsed?.treasuryLamports, 50_000_000);
  assert.deepEqual(parsed?.memos, []);
  const check = inspectExplorerTransfer(parsed, 5, MINT, { nowSec: now });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /not found|not confirmed yet/);

  const viaDecide = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: null,
    explorer: parsed,
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(viaDecide.ok, false);
  if (!viaDecide.ok) assert.match(viaDecide.error, /not found|not confirmed yet/);
});

test("explorer success + amount ok + matching memo is ok", () => {
  const now = 1_800_000_000;
  const explorer = {
    success: true,
    blockTime: now - 30,
    treasuryLamports: 50_000_000,
    memos: [bidMemoData(MINT)],
  };
  const check = inspectExplorerTransfer(explorer, 5, MINT, { nowSec: now });
  assert.equal(check.ok, true);

  const viaDecide = decideTransferVerification({
    status: null,
    tx: null,
    explorer,
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(viaDecide.ok, true);
});

test("explorer success + amount ok + wrong memo is memo mismatch", () => {
  const now = 1_800_000_000;
  const explorer = {
    success: true,
    blockTime: now - 30,
    treasuryLamports: 50_000_000,
    memos: [bidMemoData(OTHER)],
  };
  const check = inspectExplorerTransfer(explorer, 5, MINT, { nowSec: now });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /does not match/);

  const viaDecide = decideTransferVerification({
    status: { err: null, confirmationStatus: "confirmed" },
    tx: null,
    explorer,
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(viaDecide.ok, false);
  if (!viaDecide.ok) assert.match(viaDecide.error, /does not match/);
});

test("inspectable parsed tx still wins and stays strict", () => {
  const now = 1_800_000_000;
  const explorer = {
    success: true,
    blockTime: now - 30,
    treasuryLamports: 50_000_000,
    memos: [bidMemoData(MINT)],
  };
  const wrongMemoTx = mockTx({
    lamports: 50_000_000,
    memo: bidMemoData(OTHER),
    blockTime: now - 30,
  });
  const reject = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: wrongMemoTx,
    explorer,
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(reject.ok, false);
  if (!reject.ok) assert.match(reject.error, /does not match/);

  const goodTx = mockTx({ lamports: 50_000_000, blockTime: now - 30 });
  const accept = decideTransferVerification({
    status: null,
    tx: goodTx,
    explorer: null,
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(accept.ok, true);

  const underpayTx = mockTx({ lamports: 49_000_000, blockTime: now - 30 });
  const underpay = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: underpayTx,
    explorer,
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(underpay.ok, false);
  if (!underpay.ok) assert.match(underpay.error, /Amount mismatch/);
});

test("explorer overpay still passes when memo matches (seen >= needed)", () => {
  const now = 1_800_000_000;
  const check = inspectExplorerTransfer(
    {
      success: true,
      blockTime: now - 30,
      treasuryLamports: 80_000_000,
      memos: [bidMemoData(MINT)],
    },
    5,
    MINT,
    { nowSec: now }
  );
  assert.equal(check.ok, true);
});

test("failed or missing Solscan does not accept a garbage signature", () => {
  const now = 1_800_000_000;
  assert.equal(parseSolscanPayload(null, TREASURY), null);
  assert.equal(parseSolscanPayload({ hello: "nope" }, TREASURY), null);
  assert.equal(parseSolscanPayload("<html>Success</html>", TREASURY), null);

  const failed = parseSolscanPayload(
    { success: false, data: { txStatus: "Fail", blockTime: now - 10 } },
    TREASURY
  );
  assert.ok(failed);
  assert.equal(failed?.success, false);
  const failedCheck = inspectExplorerTransfer(failed, 5, MINT, { nowSec: now });
  assert.equal(failedCheck.ok, false);
  if (!failedCheck.ok) assert.match(failedCheck.error, /failed on-chain/);

  const missing = decideTransferVerification({
    status: null,
    tx: null,
    explorer: null,
    payUnits: 5,
    mint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /not found/);

  const successNoAmount = inspectExplorerTransfer(
    {
      success: true,
      blockTime: now - 30,
      treasuryLamports: 0,
      memos: [],
    },
    5,
    MINT,
    { nowSec: now }
  );
  assert.equal(successNoAmount.ok, false);
  if (!successNoAmount.ok) assert.match(successNoAmount.error, /not found/);

  const shortAmount = inspectExplorerTransfer(
    {
      success: true,
      blockTime: now - 30,
      treasuryLamports: 1,
      memos: [],
    },
    5,
    MINT,
    { nowSec: now }
  );
  assert.equal(shortAmount.ok, false);
  if (!shortAmount.ok) assert.match(shortAmount.error, /Amount mismatch/);
});

test("used signature replay is case-insensitive", () => {
  const onchain =
    "4PzFiN3Prk21y93C6qUV4ajfQRn1wUr5eNJWiyEMht1bXuA4zJGDgGmvb5aqCKEyhzT63sFmW3XYJJ3fDcey8BhT";
  const typed =
    "4PzFiN3Prk21y93C6qUV4ajfQRn1wUr5eNJWiyEMHt1bXuA4zJGDgGmvb5aqCKEyhzT63sFmW3XYJJ3fDcey8BhT";
  assert.equal(usedSignatureExists([onchain], typed), true);
  assert.equal(usedSignatureExists([onchain], onchain), true);
  assert.equal(usedSignatureExists([], typed), false);
  assert.equal(usedSignatureExists([onchain], "other"), false);
});

test("treasury history matches the paid sig even when explorer case differs", () => {
  const onchain =
    "4PzFiN3Prk21y93C6qUV4ajfQRn1wUr5eNJWiyEMht1bXuA4zJGDgGmvb5aqCKEyhzT63sFmW3XYJJ3fDcey8BhT";
  const typed =
    "4PzFiN3Prk21y93C6qUV4ajfQRn1wUr5eNJWiyEMHt1bXuA4zJGDgGmvb5aqCKEyhzT63sFmW3XYJJ3fDcey8BhT";
  assert.equal(signaturesMatch(onchain, typed), true);
  assert.equal(
    parseHistoryMemo("[50] apebid:pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn"),
    "apebid:pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn"
  );
  const found = findTreasurySignature(
    [
      {
        signature: onchain,
        err: null,
        confirmationStatus: "finalized",
        blockTime: 1_787_325_287,
        memo: "[50] apebid:pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
        slot: 440713453,
      },
    ],
    typed
  );
  assert.ok(found);
  assert.equal(found?.signature, onchain);
  assert.equal(found?.confirmationStatus, "finalized");
});

test("incomplete parsed tx with old blockTime is rejected even if finalized", () => {
  const now = 1_800_000_000;
  const check = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: {
      blockTime: now - BID_MAX_AGE_SECONDS - 10,
      meta: { err: null, preBalances: [], postBalances: [] },
      transaction: { message: { instructions: [] } },
    },
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /too old/);
});

test("clickUrl host allowlist", () => {
  assert.equal(isAllowedClickUrl("https://pump.fun/coin/" + MINT), true);
  assert.equal(isAllowedClickUrl("https://www.pump.fun/coin/" + MINT), true);
  assert.equal(isAllowedClickUrl("https://solscan.io/token/" + MINT), true);
  assert.equal(isAllowedClickUrl("https://www.solscan.io/token/" + MINT), true);
  assert.equal(isAllowedClickUrl("http://solscan.io/token/" + MINT), false);
  assert.equal(isAllowedClickUrl("https://evil.example/coin/" + MINT), false);
  assert.equal(isAllowedClickUrl("https://pump.fun.evil.example/"), false);
  assert.equal(isAllowedClickUrl("https://not-solscan.io/token/" + MINT), false);
  assert.equal(isAllowedClickUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedClickUrl("https://example.com/?next=https://pump.fun"), false);
});

test("production/Vercel without hosted DB is not a durable store", () => {
  const prev = {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  try {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    delete process.env.DATABASE_URL;
    assert.equal(durableStoreConfigured(), false);
    assert.equal(hostedStoreConfigured(), false);
    assert.equal(canAcceptPaidBid(), false);
    assert.equal(neonUrl(), null);
  } finally {
    restoreEnv(prev);
  }
});

test("DATABASE_URL counts as a hosted store on Vercel", () => {
  const prev = {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  try {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.DATABASE_URL = "postgresql://user:pass@ep-example.neon.tech/neondb";
    assert.equal(durableStoreConfigured(), true);
    assert.equal(hostedStoreConfigured(), true);
    assert.equal(canAcceptPaidBid(), true);
    assert.ok(neonUrl());
  } finally {
    restoreEnv(prev);
  }
});

test("official public RPC is identified", () => {
  assert.equal(isOfficialRpc(OFFICIAL_RPC), true);
  assert.equal(isOfficialRpc(OFFICIAL_RPC + "/"), true);
  assert.equal(isOfficialRpc(PUBLIC_FALLBACK_RPC), false);
});

test("serverRpcUrl defaults to official and keeps publicnode as fallback", () => {
  const prev = {
    SOLANA_RPC: process.env.SOLANA_RPC,
    NEXT_PUBLIC_SOLANA_RPC: process.env.NEXT_PUBLIC_SOLANA_RPC,
  };
  try {
    delete process.env.SOLANA_RPC;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC;
    assert.equal(serverRpcUrl(), OFFICIAL_RPC);
    assert.deepEqual(serverRpcCandidates(), [OFFICIAL_RPC, PUBLIC_FALLBACK_RPC]);

    process.env.NEXT_PUBLIC_SOLANA_RPC = PUBLIC_FALLBACK_RPC;
    assert.equal(serverRpcUrl(), OFFICIAL_RPC);

    process.env.SOLANA_RPC = "https://example-rpc.invalid";
    assert.equal(serverRpcUrl(), "https://example-rpc.invalid");
    assert.deepEqual(serverRpcCandidates(), [
      "https://example-rpc.invalid",
      OFFICIAL_RPC,
      PUBLIC_FALLBACK_RPC,
    ]);

    process.env.SOLANA_RPC = OFFICIAL_RPC;
    assert.deepEqual(serverRpcCandidates(), [OFFICIAL_RPC, PUBLIC_FALLBACK_RPC]);
  } finally {
    restoreEnv(prev);
  }
});

test("rpc proxy allowlist covers bid path and blocks admin methods", () => {
  assert.equal(isAllowedRpcMethod("getLatestBlockhash"), true);
  assert.equal(isAllowedRpcMethod("getSignatureStatuses"), true);
  assert.equal(isAllowedRpcMethod("sendTransaction"), true);
  assert.equal(isAllowedRpcMethod("getParsedTransaction"), true);
  assert.equal(isAllowedRpcMethod("getRecentPrioritizationFees"), true);
  assert.equal(isAllowedRpcMethod("simulateTransaction"), true);
  assert.equal(isAllowedRpcMethod("getBalance"), true);
  assert.equal(isAllowedRpcMethod("getAccountInfo"), true);
  assert.equal(isAllowedRpcMethod("requestAirdrop"), false);
  assert.equal(isAllowedRpcMethod("send"), false);
});

test("upstream 403/5xx is retryable so official can fall back to publicnode", () => {
  assert.equal(isRetryableUpstreamStatus(403), true);
  assert.equal(isRetryableUpstreamStatus(429), true);
  assert.equal(isRetryableUpstreamStatus(502), true);
  assert.equal(isRetryableUpstreamStatus(200), false);
  assert.equal(isRetryableUpstreamStatus(400), false);
});

test("short wallet status uses the bid amount and does not cover bid+fee", () => {
  assert.equal(walletNeedsSolMessage(5), "this wallet needs 0.05 SOL + fee");
  assert.equal(walletNeedsSolMessage(10), "this wallet needs 0.10 SOL + fee");
  assert.equal(walletCoversBid(49_000_000, 50_000_000, DEFAULT_TX_FEE_LAMPORTS), false);
  assert.equal(
    walletCoversBid(50_000_000 + DEFAULT_TX_FEE_LAMPORTS - 1, 50_000_000, DEFAULT_TX_FEE_LAMPORTS),
    false
  );
  assert.equal(
    walletCoversBid(50_000_000 + DEFAULT_TX_FEE_LAMPORTS, 50_000_000, DEFAULT_TX_FEE_LAMPORTS),
    true
  );
});

test("pre-sim RPC params disable sigVerify", () => {
  const params = simulateTransactionRpcParams("dGVzdA==");
  assert.equal(params[1].sigVerify, false);
  assert.equal(params[1].encoding, "base64");
});

test("simulate error surfaces the RPC error text", () => {
  assert.match(
    formatSimulateError(
      { InstructionError: [0, { Custom: 1 }] },
      ["Program log: Transfer: insufficient lamports"]
    ),
    /insufficient lamports/
  );
});

test("rpc proxy is same-origin only", () => {
  const req = (headers: Record<string, string>, url = "https://apebid.lol/api/rpc") =>
    new Request(url, { method: "POST", headers });

  assert.equal(
    isSameOriginRequest(
      req({ origin: "https://apebid.lol", host: "apebid.lol", "x-forwarded-proto": "https" })
    ),
    true
  );
  assert.equal(
    isSameOriginRequest(
      req({
        referer: "https://apebid.lol/bid",
        host: "apebid.lol",
        "x-forwarded-proto": "https",
      })
    ),
    true
  );
  assert.equal(
    isSameOriginRequest(
      req({ origin: "https://evil.example", host: "apebid.lol", "x-forwarded-proto": "https" })
    ),
    false
  );
  assert.equal(
    isSameOriginRequest(req({ host: "apebid.lol", "x-forwarded-proto": "https" })),
    false
  );
  assert.equal(clientRequestOrigin(req({ origin: "https://apebid.lol" })), "https://apebid.lol");
});

test("rpc burst limiter trips after the window max", () => {
  const key = `test-${Date.now()}-${Math.random()}`;
  const now = 1_800_000_000_000;
  for (let i = 0; i < 40; i += 1) {
    assert.equal(rpcBurstLimited(key, now, 10_000, 40), false);
  }
  assert.equal(rpcBurstLimited(key, now, 10_000, 40), true);
  assert.equal(rpcBurstLimited(key, now + 10_000, 10_000, 40), false);
});

test("bid burst limiter trips after ~10 requests per 10s", () => {
  const key = `bid-test-${Date.now()}-${Math.random()}`;
  const now = 1_800_000_000_000;
  for (let i = 0; i < 10; i += 1) {
    assert.equal(bidBurstLimited(key, now, 10_000, 10), false);
  }
  assert.equal(bidBurstLimited(key, now, 10_000, 10), true);
  assert.equal(bidBurstLimited(key, now + 10_000, 10_000, 10), false);
});

test("client wallet RPC is same-origin proxy, not official public RPC", () => {
  assert.equal(RPC_PROXY_PATH, "/api/rpc");
  assert.equal(clientRpcEndpoint(), "/api/rpc");
  assert.equal(clientRpcEndpoint().includes("api.mainnet-beta.solana.com"), false);
});

test("browser bid/wallet sources never call official public RPC", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = [
    "src/components/BidForm.tsx",
    "src/components/WalletProviders.tsx",
    "src/components/Providers.tsx",
    "src/lib/bidPreflight.ts",
    "src/lib/bidConfirm.ts",
    "src/lib/bidRecord.ts",
    "src/lib/constants.ts",
  ];
  for (const file of files) {
    const src = readFileSync(join(root, file), "utf8");
    assert.equal(src.includes("https://api.mainnet-beta.solana.com"), false, file);
    assert.equal(src.includes("https://solana-rpc.publicnode.com"), false, file);
  }
});

test("BidForm posts the signature immediately and does not wait to confirm", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const src = readFileSync(join(root, "src/components/BidForm.tsx"), "utf8");
  assert.match(src, /sendTransaction\(tx, connection\)/);
  assert.match(src, /postBid\(sig\)/);
  assert.match(src, /recordPaidBid\(sig\)/);
  assert.match(src, /recordBidWithRetry/);
  assert.match(src, /recording — retry this signature/);
  assert.equal(src.includes("waitForSignatureLanded"), false);
  assert.equal(src.includes("confirmTransaction"), false);
  assert.equal(/paste[\s\S]{0,40}signature/i.test(src), false);
  assert.equal(src.includes("claimSignature"), false);
});

test("not-confirmed record errors retry; memo and amount errors do not", () => {
  assert.equal(
    isRetryableRecordError("Transaction not found / not confirmed yet."),
    true
  );
  assert.equal(isRetryableRecordError("Board store is unavailable."), true);
  assert.equal(isRetryableRecordError("bid failed (503)"), true);
  assert.equal(isRetryableRecordError("Payment memo is missing."), true);
  assert.equal(isRetryableRecordError("Payment memo does not match this listing."), false);
  assert.equal(isRetryableRecordError("Amount mismatch: treasury gained 1 lamports, expected 50000000."), false);
  assert.equal(isRetryableRecordError("Transaction failed on-chain."), false);
  assert.ok(BID_RECORD_RETRY_WINDOW_MS >= 90_000);
});

test("recordBidWithRetry posts immediately then retries the same signature", async () => {
  let n = 0;
  let t = 0;
  const posted: number[] = [];
  const result = await recordBidWithRetry({
    post: async () => {
      n += 1;
      posted.push(t);
      if (n < 3) throw new Error("Transaction not found / not confirmed yet.");
      return { ok: true, n };
    },
    windowMs: 10_000,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.n, 3);
  assert.equal(n, 3);
  assert.equal(posted[0], 0);
});

test("recordBidWithRetry does not retry a memo mismatch", async () => {
  let n = 0;
  await assert.rejects(
    () =>
      recordBidWithRetry({
        post: async () => {
          n += 1;
          throw new Error("Payment memo does not match this listing.");
        },
        windowMs: 10_000,
        now: () => 0,
        sleep: async () => {},
      }),
    /does not match/
  );
  assert.equal(n, 1);
});

test("landed or expired blockhash still records the bid", () => {
  assert.equal(signatureLandedOk({ err: null, confirmationStatus: "confirmed" }), true);
  assert.equal(signatureLandedOk({ err: null, confirmationStatus: "finalized" }), true);
  assert.equal(signatureLandedOk({ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }), false);
  assert.equal(signatureLandedOk(null), false);
  assert.equal(shouldPostBid({ kind: "landed" }), true);
  assert.equal(shouldPostBid({ kind: "expired" }), true);
  assert.equal(shouldPostBid({ kind: "timeout" }), true);
  assert.equal(shouldPostBid({ kind: "failed", error: "on-chain err" }), false);
  const expired = new Error("Transaction block height exceeded");
  expired.name = "TransactionExpiredBlockheightExceededError";
  assert.equal(isBlockHeightExceededError(expired), true);
  assert.equal(isBlockHeightExceededError(new Error("block height exceeded")), true);
  assert.equal(isBlockHeightExceededError(new Error("insufficient funds")), false);
});

test("poll getSignatureStatuses ignores stale blockhash and waits for confirmed", async () => {
  let n = 0;
  let t = 0;
  const outcome = await waitForSignatureLanded(
    async () => {
      n += 1;
      if (n === 1) return null;
      return { err: null, confirmationStatus: "finalized" };
    },
    "test-sig",
    {
      timeoutMs: 5_000,
      intervalMs: 1,
      now: () => t,
      sleep: async () => {
        t += 1;
      },
    }
  );
  assert.equal(outcome.kind, "landed");
});

test("poll treats confirm block-height errors as expired, not a failed bid", async () => {
  const outcome = await waitForSignatureLanded(
    async () => {
      const err = new Error("block height exceeded");
      err.name = "TransactionExpiredBlockheightExceededError";
      throw err;
    },
    "sig",
    { timeoutMs: 5, intervalMs: 1, now: () => 0, sleep: async () => {} }
  );
  assert.equal(outcome.kind, "expired");
  assert.equal(shouldPostBid(outcome), true);
});

test("bid priority fee is modest and adds no extra signer", () => {
  assert.ok(BID_PRIORITY_FEE_LAMPORTS <= 5_000);
  assert.ok(BID_CU_PRICE_MICRO_LAMPORTS <= 50_000);
  const ixs = bidComputeBudgetIxs();
  assert.equal(ixs.length, 2);
  for (const ix of ixs) {
    assert.equal(ix.keys.filter((k) => k.isSigner).length, 0);
  }
});

test("Ape is disabled until a successful state load", () => {
  assert.equal(apeEnabled({ boardReady: false, pendingSig: null, busy: false }), false);
  assert.equal(apeEnabled({ boardReady: true, pendingSig: null, busy: false }), true);
  assert.equal(apeEnabled({ boardReady: true, pendingSig: "sig", busy: false }), false);
  assert.equal(apeEnabled({ boardReady: true, pendingSig: null, busy: true }), false);
});

test("/api/state failure is not treated as an empty board", () => {
  const prev = [
    {
      id: "pump",
      identity: MINT,
      mint: MINT,
      clickUrl: `https://pump.fun/coin/${MINT}`,
      ticker: "PUMP",
      name: "PUMP",
      tagline: "",
      bidUnits: 50,
      paidUnits: 50,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      clicks: 1,
      rank: 1,
    },
  ];
  assert.equal(isHealthyBoardState(false, { ok: true, listings: [] }), false);
  assert.equal(isHealthyBoardState(true, { ok: false, error: "down", listings: [] }), false);
  assert.equal(isHealthyBoardState(true, { listings: [] }), false);
  assert.equal(isHealthyBoardState(true, emptyStatePayload()), false);
  assert.equal(emptyStatePayload().ok, false);

  const failed = applyBoardState({
    prevListings: prev,
    prevReady: true,
    resOk: true,
    data: { ok: false, error: "Board store is unavailable.", listings: [] },
  });
  assert.equal(failed.applied, false);
  assert.equal(failed.boardReady, true);
  assert.equal(failed.listings, prev);
  assert.equal(failed.listings[0]?.ticker, "PUMP");

  const firstFail = applyBoardState({
    prevListings: [],
    prevReady: false,
    resOk: false,
    data: { listings: [] },
  });
  assert.equal(firstFail.boardReady, false);
  assert.deepEqual(firstFail.listings, []);

  const healthyEmpty = applyBoardState({
    prevListings: prev,
    prevReady: true,
    resOk: true,
    data: { ok: true, listings: [] },
  });
  assert.equal(healthyEmpty.applied, true);
  assert.equal(healthyEmpty.boardReady, true);
  assert.deepEqual(healthyEmpty.listings, []);
});

test("first-paint listings=[] does not compute a new payUnits that gets sent", () => {
  const plan = clientBidPlan({
    boardReady: false,
    listings: [],
    identity: MINT,
    bidUnits: 5,
  });
  assert.equal(plan.canPay, false);
  if (plan.canPay === false) assert.equal(plan.reason, "board-not-ready");

  const readyNew = clientBidPlan({
    boardReady: true,
    listings: [],
    identity: MINT,
    bidUnits: 5,
  });
  assert.equal(readyNew.canPay, true);
  if (readyNew.canPay) {
    assert.equal(readyNew.isRaise, false);
    assert.equal(readyNew.payUnits, 5);
  }

  const raise = clientBidPlan({
    boardReady: true,
    listings: [{ identity: MINT, bidUnits: 10 }],
    identity: MINT,
    bidUnits: 15,
  });
  assert.equal(raise.canPay, true);
  if (raise.canPay) {
    assert.equal(raise.isRaise, true);
    assert.equal(raise.payUnits, 5);
  }
});

test("pendingSig survives remount via sessionStorage", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };
  writePendingBid(
    { signature: "sig111", identity: MINT, amountSol: 0.05 },
    storage
  );
  assert.equal(mem.has(PENDING_BID_KEY), true);
  const restored = readPendingBid(storage);
  assert.ok(restored);
  assert.equal(restored?.signature, "sig111");
  assert.equal(restored?.identity, MINT);
  assert.equal(restored?.amountSol, 0.05);
  assert.equal(apeEnabled({ boardReady: true, pendingSig: restored!.signature }), false);
  clearPendingBid(storage);
  assert.equal(readPendingBid(storage), null);
});

test("treasury history memo matching mint lists the paid tx", () => {
  const now = 1_800_000_000;
  const tx = mockTx({ lamports: 50_000_000, memo: null, blockTime: now - 30 });
  const viaParsed = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx,
    history: { memo: bidMemoData(MINT), blockTime: now - 30, err: null },
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(viaParsed.ok, true);

  const prefixed = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: null,
    history: {
      memo: `[50] ${bidMemoData(MINT)}`,
      blockTime: now - 20,
      err: null,
    },
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(prefixed.ok, false);
  if (!prefixed.ok) assert.match(prefixed.error, /not found|not confirmed yet/);
  assert.equal(isDefinitiveVerifyFailure(prefixed), false);
  assert.equal(parseHistoryMemo(`[50] ${bidMemoData(MINT)}`), bidMemoData(MINT));
});

test("history-memo without amount is retryable, not an accept", () => {
  const now = 1_800_000_000;
  const check = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: null,
    history: {
      memo: bidMemoData(MINT),
      blockTime: now - 15,
      err: null,
    },
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /not found|not confirmed yet/);
  assert.equal(isDefinitiveVerifyFailure(check), false);
  assert.equal(isRetryableRecordError(check.error), true);
  assert.equal(historyTreasuryLamports({ memo: bidMemoData(MINT) }), null);
});

test("history-memo with amount accepts seen >= needed and rejects underpay", () => {
  const now = 1_800_000_000;
  const accept = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: null,
    history: {
      memo: bidMemoData(MINT),
      blockTime: now - 15,
      err: null,
      lamports: 50_000_000,
    },
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(accept.ok, true);

  const overpay = decideTransferVerification({
    status: null,
    tx: null,
    history: {
      memo: `[50] ${bidMemoData(MINT)}`,
      blockTime: now - 10,
      err: null,
      treasuryLamports: 80_000_000,
    },
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(overpay.ok, true);

  const underpay = decideTransferVerification({
    status: { err: null, confirmationStatus: "confirmed" },
    tx: null,
    history: {
      memo: bidMemoData(MINT),
      blockTime: now - 10,
      err: null,
      lamports: 1,
    },
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(underpay.ok, false);
  if (!underpay.ok) assert.match(underpay.error, /Amount mismatch/);
  assert.equal(isDefinitiveVerifyFailure(underpay), true);
});

test("explorer missing blockTime fails like inspectTransfer", () => {
  const now = 1_800_000_000;
  const check = inspectExplorerTransfer(
    {
      success: true,
      blockTime: null,
      treasuryLamports: 50_000_000,
      memos: [bidMemoData(MINT)],
    },
    5,
    MINT,
    { nowSec: now }
  );
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /time is unavailable/);
});

test("parsed transfer with no memo retries and can use explorer", () => {
  const now = 1_800_000_000;
  const tx = mockTx({ lamports: 50_000_000, memo: null, blockTime: now - 30 });
  const missing = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx,
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /not found|not confirmed yet/);
  assert.equal(isDefinitiveVerifyFailure(missing), false);
  assert.equal(isRetryableRecordError(missing.error), true);

  const viaExplorer = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx,
    explorer: {
      success: true,
      blockTime: now - 30,
      treasuryLamports: 50_000_000,
      memos: [bidMemoData(MINT)],
    },
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(viaExplorer.ok, true);
});

test("bid and rpc origins are pinned to apebid hosts, not x-forwarded-host", () => {
  const req = (headers: Record<string, string>, url = "https://apebid.lol/api/bid") =>
    new Request(url, { method: "POST", headers });

  assert.equal(isAllowedSiteOrigin("https://apebid.lol"), true);
  assert.equal(isAllowedSiteOrigin("https://www.apebid.lol"), true);
  assert.equal(isAllowedSiteOrigin("https://evil.example"), false);
  assert.equal(
    isAllowedSiteRequest(
      req({
        origin: "https://evil.example",
        host: "apebid.lol",
        "x-forwarded-host": "apebid.lol",
        "x-forwarded-proto": "https",
      })
    ),
    false
  );
  assert.equal(
    isAllowedSiteRequest(req({ origin: "https://www.apebid.lol" })),
    true
  );
  assert.equal(isAllowedSiteOrigin("https://apebid-prod.vercel.app"), true);
  assert.equal(isAllowedSiteOrigin("https://apebid-git-main.vercel.app"), false);
  assert.equal(isAllowedSiteOrigin("https://evil.vercel.app"), false);
  assert.equal(isAllowedSiteOrigin("https://random-preview.vercel.app"), false);
  assert.equal(isAllowedSiteOrigin("http://localhost:3001"), true);
  assert.equal(
    isAllowedSiteOrigin("http://localhost:3001", { VERCEL: "1" }),
    false
  );
});

test("visitor cookie is Secure, HttpOnly, SameSite=lax", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const mw = readFileSync(join(root, "src/middleware.ts"), "utf8");
  assert.match(mw, /secure:\s*true/);
  assert.match(mw, /httpOnly:\s*true/);
  assert.match(mw, /sameSite:\s*"lax"/);
  assert.match(mw, /path:\s*"\/"/);
  assert.match(mw, /apebid-visitor-id/);
});

test("ticker keeps last-good stats on fail or empty 200 payloads", () => {
  assert.equal(readTickerStats({ ok: false, live: 0, last12h: 0, sinceLaunch: 0, revenueSol: 0 }), null);
  assert.equal(readTickerStats({}), null);
  assert.equal(readTickerStats({ listings: [] }), null);
  assert.equal(readTickerStats(emptyStatePayload()), null);
  const good = readTickerStats({
    ok: true,
    live: 3,
    last12h: 12,
    sinceLaunch: 40,
    revenueSol: 1.25,
  });
  assert.ok(good);
  assert.equal(good?.live, 3);
  assert.equal(good?.revenueSol, 1.25);
});

test("https-only token images and click urls", () => {
  assert.equal(httpsImageUrl("http://cdn.example/a.png"), null);
  assert.equal(httpsImageUrl("https://cdn.example/a.png"), null);
  assert.equal(httpsImageUrl("https://evil.example/a.png"), null);
  assert.equal(
    httpsImageUrl("https://ipfs.io/ipfs/abc"),
    "https://ipfs.io/ipfs/abc"
  );
  assert.equal(isAllowedImageHost("gateway.ipfs.io"), true);
  assert.equal(isAllowedImageHost("pump.mypinata.cloud"), true);
  assert.equal(isAllowedImageHost("dd.dexscreener.com"), true);
  assert.equal(isAllowedImageHost("cdn.example"), false);
  assert.equal(isAllowedClickUrl("https://solscan.io/token/" + MINT), true);
});

test("source locks: no send until ready, pending restore, verify outside lock", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const bidForm = readFileSync(join(root, "src/components/BidForm.tsx"), "utf8");
  assert.match(bidForm, /boardReady/);
  assert.match(bidForm, /loading board/);
  assert.match(bidForm, /writePendingBid/);
  assert.match(bidForm, /readPendingBid/);
  assert.match(bidForm, /clearPendingBid/);
  assert.match(bidForm, /apeEnabled/);
  assert.equal(/paste[\s\S]{0,40}signature/i.test(bidForm), false);
  assert.equal(bidForm.includes("claimSignature"), false);
  assert.match(bidForm, /maxLength=\{12\}/);
  assert.match(bidForm, /maxLength=\{32\}/);
  assert.match(bidForm, /maxLength=\{140\}/);

  const home = readFileSync(join(root, "src/components/HomeClient.tsx"), "utf8");
  assert.match(home, /isHealthyBoardState/);
  assert.match(home, /boardReady/);
  assert.equal(home.includes("setListings([])"), false);

  const state = readFileSync(join(root, "src/app/api/state/route.ts"), "utf8");
  assert.match(state, /ok:\s*true/);
  assert.match(state, /emptyStatePayload/);
  assert.match(state, /status/);

  const bid = readFileSync(join(root, "src/app/api/bid/route.ts"), "utf8");
  const lockAt = bid.indexOf("await updateStore");
  assert.ok(lockAt > 0);
  assert.equal(bid.slice(lockAt).includes("verifyTransfer"), false);
  assert.ok(bid.indexOf("verifyTransfer") < lockAt);
  assert.match(bid, /isAllowedSiteRequest/);
  assert.match(bid, /bidBurstLimited/);

  const rpc = readFileSync(join(root, "src/app/api/rpc/route.ts"), "utf8");
  assert.match(rpc, /isAllowedSiteRequest/);
  assert.equal(rpc.includes("x-apebid-rpc-host"), false);

  const rpcLib = readFileSync(join(root, "src/lib/rpc.ts"), "utf8");
  assert.equal(rpcLib.includes('endsWith(".vercel.app")'), false);
  assert.match(rpcLib, /apebid-prod\.vercel\.app/);

  const mw = readFileSync(join(root, "src/middleware.ts"), "utf8");
  assert.match(mw, /secure:\s*true/);
  assert.match(mw, /httpOnly:\s*true/);
  assert.match(mw, /sameSite:\s*"lax"/);

  const click = readFileSync(join(root, "src/lib/clickRedirect.ts"), "utf8");
  assert.match(click, /incrementListingClicks/);
  assert.equal(click.includes("row.clicks"), false);

  const storeSrc = readFileSync(join(root, "src/lib/store.ts"), "utf8");
  assert.match(storeSrc, /clicks = clicks \+ 1/);
  assert.equal(storeSrc.includes("clicks=excluded.clicks"), false);

  const neonSrc = readFileSync(join(root, "src/lib/storeNeon.ts"), "utf8");
  assert.match(neonSrc, /clicks = clicks \+ 1/);
  assert.equal(neonSrc.includes("clicks = EXCLUDED.clicks"), false);

  const board = readFileSync(join(root, "src/components/Board.tsx"), "utf8");
  assert.equal(/href=\{[^}]*imageUrl/.test(board), false);

  const ticker = readFileSync(join(root, "src/components/Ticker.tsx"), "utf8");
  assert.match(ticker, /readTickerStats/);
  assert.match(ticker, /if \(!next\) return/);

  const store = readFileSync(join(root, "src/lib/store.ts"), "utf8");
  assert.match(store, /StoreUnavailableError/);
  assert.match(store, /listings_identity_uidx/);

  const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /index:\s*true/);
  assert.match(layout, /og:url|url:\s*"https:\/\/www\.apebid\.lol"/);

  const nextCfg = readFileSync(join(root, "next.config.ts"), "utf8");
  assert.match(nextCfg, /X-Frame-Options/);
  assert.match(nextCfg, /DENY/);
  assert.match(nextCfg, /frame-ancestors 'none'/);
});

function restoreEnv(prev: Record<string, string | undefined>) {
  const env = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

async function main() {
  for (const { name, fn } of pending) {
    try {
      await fn();
      passed += 1;
      console.log(`ok  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(err);
    }
  }
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

void main();
