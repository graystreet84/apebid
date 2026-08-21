"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { MIN_SOL, STEP_SOL, TREASURY_ADDRESS, toLamports, roundSol } from "@/lib/constants";
import {
  DEFAULT_TX_FEE_LAMPORTS,
  bidComputeBudgetIxs,
  formatSimulateError,
  simulateUnsignedTransaction,
  walletCoversBid,
  walletNeedsSolMessage,
} from "@/lib/bidPreflight";
import { bidMemoData, MEMO_PROGRAM_ID } from "@/lib/memo";
import { formatSol, solToUnits, unitsToSol, type RankedListing } from "@/lib/types";
import { parseIdentity } from "@/lib/validate";
import { previewRank } from "@/lib/ranking";
import {
  BID_RECORD_RETRY_WINDOW_MS,
  recordBidWithRetry,
} from "@/lib/bidRecord";
import { apeEnabled, clientBidPlan } from "@/lib/boardClient";
import {
  clearPendingBid,
  readPendingBid,
  writePendingBid,
} from "@/lib/pendingBid";
import { WalletButton } from "./WalletButton";

const FAKE_ON = process.env.NEXT_PUBLIC_DEV_FAKE_TX === "true";

type Props = {
  listings: RankedListing[];
  boardReady: boolean;
  onDone: () => void;
};

export function BidForm({ listings, boardReady, onDone }: Props) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [identity, setIdentity] = useState("");
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [amount, setAmount] = useState(String(MIN_SOL));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingSig, setPendingSig] = useState<string | null>(null);

  useEffect(() => {
    const restored = readPendingBid();
    if (!restored) return;
    setPendingSig(restored.signature);
    setIdentity(restored.identity);
    setAmount(String(restored.amountSol));
    setStatus(
      `paid on-chain. recording ${restored.signature.slice(0, 8)}… do not send a second payment. sig: ${restored.signature}`
    );
  }, []);

  useEffect(() => {
    const onClaim = (e: Event) => {
      const sol = (e as CustomEvent<number>).detail;
      if (typeof sol === "number" && Number.isFinite(sol)) {
        setAmount(String(roundSol(sol)));
      }
    };
    window.addEventListener("apebid-claim", onClaim);
    return () => window.removeEventListener("apebid-claim", onClaim);
  }, []);

  const bidSol = roundSol(Number(amount) || 0);
  const bidUnits = solToUnits(bidSol);
  const parsed = useMemo(() => parseIdentity(identity), [identity]);
  const plan = clientBidPlan({
    boardReady,
    listings,
    identity: parsed.ok ? parsed.value.identity : undefined,
    bidUnits,
  });
  const existing = parsed.ok
    ? listings.find((l) => l.identity === parsed.value.identity)
    : undefined;
  const isRaise = plan.canPay ? plan.isRaise : Boolean(existing);
  const payUnits = plan.canPay ? plan.payUnits : 0;
  const liveRank =
    parsed.ok && bidUnits >= 5
      ? previewRank(listings, bidUnits, parsed.value.identity)
      : bidUnits >= 5
        ? previewRank(listings, bidUnits)
        : null;

  async function postBid(signature?: string) {
    const res = await fetch("/api/bid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity,
        ticker,
        name,
        tagline,
        amountSol: bidSol,
        bidSol,
        signature,
        fake: !signature,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      rank?: number;
      paidUnits?: number;
    };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `bid failed (${res.status})`);
    }
    return data;
  }

  async function recordPaidBid(sig: string) {
    return recordBidWithRetry({
      post: () => postBid(sig),
      windowMs: BID_RECORD_RETRY_WINDOW_MS,
      onRetry: () => {
        setStatus(`recording ${sig.slice(0, 8)}… still confirming. do not send again`);
      },
    });
  }

  async function onApe() {
    setStatus("");
    if (!boardReady) {
      setStatus("loading board…");
      return;
    }
    if (pendingSig) {
      await onRetryRecord();
      return;
    }
    if (!parsed.ok) {
      setStatus(parsed.error);
      return;
    }
    if (bidSol < MIN_SOL) {
      setStatus("0.05 SOL minimum");
      return;
    }
    if (isRaise && payUnits <= 0) {
      setStatus("raise must beat the current bid");
      return;
    }
    if (!connected || !publicKey) {
      setStatus("connect Phantom or Solflare first");
      return;
    }
    if (!TREASURY_ADDRESS) {
      setStatus("treasury address missing");
      return;
    }
    setBusy(true);
    try {
      const payLamports = toLamports(unitsToSol(payUnits));
      setStatus("checking wallet…");
      let lamports: number;
      try {
        lamports = await connection.getBalance(publicKey, "confirmed");
      } catch (err) {
        setStatus(
          err instanceof Error ? err.message : "could not read wallet balance"
        );
        return;
      }

      const mint = parsed.value.mint;
      const tx = new Transaction().add(
        ...bidComputeBudgetIxs(),
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(TREASURY_ADDRESS),
          lamports: payLamports,
        }),
        new TransactionInstruction({
          keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
          programId: new PublicKey(MEMO_PROGRAM_ID),
          data: Buffer.from(bidMemoData(mint), "utf8"),
        })
      );
      const latest = await connection.getLatestBlockhash("confirmed");
      tx.feePayer = publicKey;
      tx.recentBlockhash = latest.blockhash;

      let feeLamports = DEFAULT_TX_FEE_LAMPORTS;
      try {
        const fee = await connection.getFeeForMessage(tx.compileMessage(), "confirmed");
        if (typeof fee.value === "number") feeLamports = fee.value;
      } catch {
        /* keep conservative buffer */
      }

      if (!walletCoversBid(lamports, payLamports, feeLamports)) {
        setStatus(walletNeedsSolMessage(payUnits));
        return;
      }

      setStatus("checking transaction…");
      const encoded = Buffer.from(
        tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        })
      ).toString("base64");
      let sim;
      try {
        sim = await simulateUnsignedTransaction(encoded);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "simulation failed");
        return;
      }
      if (sim.err) {
        setStatus(formatSimulateError(sim.err, sim.logs));
        return;
      }

      setStatus("waiting for wallet sig…");
      const sig = await sendTransaction(tx, connection);
      writePendingBid({
        signature: sig,
        identity,
        amountSol: bidSol,
      });
      setPendingSig(sig);
      setStatus(`recording ${sig.slice(0, 8)}… do not send again`);
      try {
        const data = await recordPaidBid(sig);
        clearPendingBid();
        setPendingSig(null);
        setStatus(
          `listed at #${data.rank} · paid ${formatSol(data.paidUnits || payUnits)} SOL`
        );
        onDone();
      } catch (err) {
        const message = err instanceof Error ? err.message : "bid failed";
        setStatus(
          `paid on-chain. recording failed: ${message}. do not send a second payment. sig: ${sig}`
        );
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "tx failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRetryRecord() {
    if (!pendingSig) return;
    setBusy(true);
    setStatus(`recording ${pendingSig.slice(0, 8)}… do not send again`);
    try {
      const data = await recordPaidBid(pendingSig);
      clearPendingBid();
      setPendingSig(null);
      setStatus(
        `listed at #${data.rank} · paid ${formatSol(data.paidUnits || payUnits)} SOL`
      );
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : "bid failed";
      setStatus(
        `paid on-chain. recording failed: ${message}. do not send a second payment. sig: ${pendingSig}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function onFake() {
    setStatus("");
    if (!boardReady) {
      setStatus("loading board…");
      return;
    }
    if (!parsed.ok) {
      setStatus(parsed.error);
      return;
    }
    if (bidSol < MIN_SOL) {
      setStatus("0.05 SOL minimum");
      return;
    }
    if (isRaise && payUnits <= 0) {
      setStatus("raise must beat the current bid");
      return;
    }
    setBusy(true);
    try {
      const data = await postBid();
      setStatus(
        `DEV bid landed #${data.rank} · would have paid ${formatSol(data.paidUnits || payUnits)} SOL`
      );
      onDone();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "fake bid failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="bid-form" className="ugly-box scroll-mt-4 p-3 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-smash text-xl text-hot sm:text-2xl">APE THE BOARD</h2>
        <WalletButton />
      </div>
      <p className="mt-1 text-xs text-white/65 sm:text-sm">
        New spots start at 0.05 SOL. Paying less than #1 still puts you on the
        board.
      </p>

      <label className="mt-3 block text-xs uppercase text-yell">
        CA / pump.fun
      </label>
      <input
        value={identity}
        onChange={(e) => setIdentity(e.target.value)}
        placeholder="7xKXtg… or https://pump.fun/coin/…"
        maxLength={200}
        disabled={Boolean(pendingSig)}
        className="ugly-input mt-1 w-full px-3 py-2 text-lg"
      />

      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="ticker (opt)"
          maxLength={12}
          className="ugly-input px-3 py-2"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name (opt)"
          maxLength={32}
          className="ugly-input px-3 py-2"
        />
      </div>
      <input
        value={tagline}
        onChange={(e) => setTagline(e.target.value)}
        placeholder="one-liner (opt)"
        maxLength={140}
        className="ugly-input mt-2 w-full px-3 py-2"
      />

      <label className="mt-3 block text-xs uppercase text-yell">bid (SOL)</label>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAmount(String(roundSol(Math.max(MIN_SOL, bidSol - STEP_SOL))))}
          className="ugly-input h-10 w-10 text-2xl"
        >
          −
        </button>
        <input
          type="number"
          min={MIN_SOL}
          step={STEP_SOL}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="ugly-input w-28 px-3 py-2 text-lg sm:w-32"
        />
        <button
          type="button"
          onClick={() => setAmount(String(roundSol(bidSol + STEP_SOL)))}
          className="ugly-input h-10 w-10 text-2xl"
        >
          +
        </button>
      </div>
      <p className="mt-1 text-xs font-bold text-acid">0.05 SOL minimum</p>
      <p className="mt-1 text-xs text-white/65">
        Already on the list? Same CA or pump.fun URL — you only pay the
        difference.
      </p>

      <div className="mt-3 border border-dashed border-hot/70 p-2 text-sm">
        {!boardReady ? (
          <div className="text-white/50">loading board…</div>
        ) : parsed.ok ? (
          <>
            <div>
              mint: <span className="text-acid">{parsed.value.mint.slice(0, 4)}…{parsed.value.mint.slice(-4)}</span>
            </div>
            {isRaise ? (
              <div className="text-yell">
                RAISE — pay the difference only: {formatSol(payUnits)} SOL
                {existing ? ` (now ${formatSol(existing.bidUnits)} SOL)` : ""}
              </div>
            ) : (
              <div>new listing · pay {formatSol(bidUnits)} SOL</div>
            )}
            {liveRank !== null && (
              <div>
                this amount lands at{" "}
                <span className="font-smash text-xl text-hot">#{liveRank}</span>
              </div>
            )}
          </>
        ) : identity.trim() ? (
          <div className="text-hot">{parsed.error}</div>
        ) : (
          <div className="text-white/50">paste a CA. get ranked.</div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!apeEnabled({ boardReady, pendingSig, busy })}
          onClick={onApe}
          className="ugly-cta w-full px-5 py-3 font-smash text-2xl sm:w-auto"
        >
          {busy ? "APING…" : "Ape the board"}
        </button>
        {pendingSig && !busy && (
          <button
            type="button"
            disabled={busy}
            onClick={onRetryRecord}
            className="border-2 border-yell bg-black px-4 py-2 font-bold text-yell hover:bg-yell hover:text-black disabled:opacity-50"
          >
            recording — retry this signature
          </button>
        )}
        {FAKE_ON && (
          <button
            type="button"
            disabled={busy || !boardReady}
            onClick={onFake}
            className="border-2 border-white bg-hot px-4 py-2 font-bold text-black hover:bg-white disabled:opacity-50"
          >
            Place bid (dev)
          </button>
        )}
      </div>
      {status && (
        <p className="mt-3 border border-yell bg-black px-2 py-1 text-sm text-yell">
          {status}
        </p>
      )}
      <p className="mt-3 text-xs text-white/50">
        treasury: {TREASURY_ADDRESS.slice(0, 4)}…{TREASURY_ADDRESS.slice(-4)}
        {FAKE_ON ? " · DEV_FAKE_TX on" : ""}
      </p>
    </section>
  );
}
