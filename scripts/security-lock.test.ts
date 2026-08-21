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
  inspectTransfer,
  parseHistoryMemo,
  signaturesMatch,
  type ParsedTxLike,
} from "../src/lib/solana";
import {
  inspectExplorerTransfer,
  parseSolscanPayload,
} from "../src/lib/solscan";
import { bidMemoData, BID_MAX_AGE_SECONDS, MEMO_PROGRAM_ID } from "../src/lib/memo";
import { isAllowedClickUrl } from "../src/lib/validate";
import { canAcceptPaidBid, durableStoreConfigured, hostedStoreConfigured } from "../src/lib/store";
import { neonUrl } from "../src/lib/storeNeon";
import {
  OFFICIAL_RPC,
  PUBLIC_FALLBACK_RPC,
  clientRequestOrigin,
  isAllowedRpcMethod,
  isOfficialRpc,
  isRetryableUpstreamStatus,
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

test("finalized status is accepted when parsed tx is missing", () => {
  const check = decideTransferVerification({
    status: { err: null, confirmationStatus: "finalized" },
    tx: null,
    payUnits: 5,
    mint: MINT,
    treasury: TREASURY,
  });
  assert.equal(check.ok, true);
});

test("confirmed status is accepted when parsed tx is missing", () => {
  const check = decideTransferVerification({
    status: { err: null, confirmationStatus: "confirmed" },
    tx: null,
    payUnits: 5,
    mint: MINT,
    treasury: TREASURY,
  });
  assert.equal(check.ok, true);
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

test("Solscan success + treasury amount accepts without memo", () => {
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
  const check = inspectExplorerTransfer(parsed, 5, MINT, { nowSec: now });
  assert.equal(check.ok, true);

  const viaDecide = decideTransferVerification({
    status: null,
    tx: null,
    explorer: parsed,
    payUnits: 5,
    mint: MINT,
    nowSec: now,
    treasury: TREASURY,
  });
  assert.equal(viaDecide.ok, true);
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
  assert.equal(isAllowedClickUrl("http://solscan.io/token/" + MINT), true);
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
  assert.equal(src.includes("waitForSignatureLanded"), false);
  assert.equal(src.includes("confirmTransaction"), false);
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
