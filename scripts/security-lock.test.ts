import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||=
  "Csx6qmKTzcrSQAVjRRygMQ8RqRJcAPiDNJD5ZnbZyQmt";

import { unitsToLamports } from "../src/lib/types";
import { fakeTxEnabled, inspectTransfer, type ParsedTxLike } from "../src/lib/solana";
import { bidMemoData, BID_MAX_AGE_SECONDS, MEMO_PROGRAM_ID } from "../src/lib/memo";
import { isAllowedClickUrl } from "../src/lib/validate";
import { canAcceptPaidBid, durableStoreConfigured, hostedStoreConfigured } from "../src/lib/store";
import { neonUrl } from "../src/lib/storeNeon";

const TREASURY = "Csx6qmKTzcrSQAVjRRygMQ8RqRJcAPiDNJD5ZnbZyQmt";
const MINT = "So11111111111111111111111111111111111111112";
const OTHER = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

let failed = 0;
let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  }
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

function restoreEnv(prev: Record<string, string | undefined>) {
  const env = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
