import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { SignatureUsedError, StoreUnavailableError, hostedStoreConfigured, isDurableStoreReady, updateStore } from "@/lib/store";
import { parseIdentity, parseBidSol, sanitizeText } from "@/lib/validate";
import { rankListings } from "@/lib/ranking";
import { fakeTxEnabled, verifyTransfer } from "@/lib/solana";
import { MIN_UNITS } from "@/lib/types";

export const dynamic = "force-dynamic";

type Body = {
  identity?: string;
  ticker?: string;
  name?: string;
  tagline?: string;
  amountSol?: number;
  bidSol?: number;
  signature?: string;
  txSig?: string;
  fake?: boolean;
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail(400, "Bad JSON.");
  }

  const parsedId = parseIdentity(body.identity || "");
  if (!parsedId.ok) return fail(400, parsedId.error);

  const parsedBid = parseBidSol(body.amountSol ?? body.bidSol);
  if (!parsedBid.ok) return fail(400, parsedBid.error);

  const ticker = sanitizeText(body.ticker, 12);
  const name = sanitizeText(body.name, 32);
  const tagline = sanitizeText(body.tagline, 140);
  const signature = body.signature || body.txSig;

  if (body.fake === true && !fakeTxEnabled()) {
    return fail(403, "Fake tx is disabled.");
  }
  const fake = body.fake === true && fakeTxEnabled();
  if (!fake && !signature) {
    return fail(400, "Missing transaction signature.");
  }
  if (!fake) {
    const hostedOnly =
      Boolean(process.env.VERCEL) ||
      process.env.VERCEL_ENV === "production" ||
      process.env.VERCEL_ENV === "preview";
    if (hostedOnly && !hostedStoreConfigured()) {
      return fail(503, "Board store is unavailable.");
    }
    if (!(await isDurableStoreReady())) {
      return fail(503, "Board store is unavailable.");
    }
  }

  try {
    const result = await updateStore(async (store) => {
      const existing = store.listings.find(
        (l) => l.identity === parsedId.value.identity
      );
      let payUnits = parsedBid.units;
      let kind: "new" | "raise" = "new";

      if (existing) {
        if (parsedBid.units <= existing.bidUnits) {
          throw new HttpError(
            409,
            `Raise must be higher than the current bid (${(existing.bidUnits / 100).toFixed(2)} SOL).`
          );
        }
        payUnits = parsedBid.units - existing.bidUnits;
        kind = "raise";
      } else if (parsedBid.units < MIN_UNITS) {
        throw new HttpError(400, "New spots start at 0.05 SOL.");
      }

      if (fake) {
        store.usedSignatures.push(`dev-${Date.now()}`);
      } else {
        const sig = String(signature);
        if (store.usedSignatures.includes(sig)) {
          throw new HttpError(409, "That signature was already used.");
        }
        const check = await verifyTransfer(sig, payUnits, parsedId.value.mint);
        if (!check.ok) {
          throw new HttpError(400, check.error);
        }
        store.usedSignatures.push(sig);
      }

      const now = new Date().toISOString();
      if (existing) {
        existing.bidUnits = parsedBid.units;
        existing.paidUnits += payUnits;
        existing.updatedAt = now;
        if (ticker) existing.ticker = ticker;
        if (name) existing.name = name;
        if (tagline) existing.tagline = tagline;
        existing.clickUrl = parsedId.value.clickUrl;
        existing.mint = parsedId.value.mint;
      } else {
        store.listings.push({
          id: randomUUID(),
          identity: parsedId.value.identity,
          mint: parsedId.value.mint,
          clickUrl: parsedId.value.clickUrl,
          ticker: ticker || parsedId.value.mint.slice(0, 4).toUpperCase(),
          name: name || ticker || "???",
          tagline,
          bidUnits: parsedBid.units,
          paidUnits: payUnits,
          createdAt: now,
          updatedAt: now,
          clicks: 0,
        });
      }

      const ranked = rankListings(store.listings);
      const listing = ranked.find((r) => r.identity === parsedId.value.identity)!;
      store.activity.unshift({
        id: randomUUID(),
        listingId: listing.id,
        identity: listing.identity,
        ticker: listing.ticker,
        name: listing.name,
        rank: listing.rank,
        bidUnits: listing.bidUnits,
        paidUnits: payUnits,
        kind,
        createdAt: now,
      });
      store.activity = store.activity.slice(0, 200);

      return { listing, paidUnits: payUnits, rank: listing.rank };
    });

    return NextResponse.json({
      ok: true,
      listing: result.listing,
      rank: result.rank,
      paidUnits: result.paidUnits,
      paidSol: result.paidUnits / 100,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return fail(e.status, e.message);
    }
    if (e instanceof SignatureUsedError) {
      return fail(409, e.message);
    }
    if (e instanceof StoreUnavailableError) {
      return fail(503, e.message);
    }
    console.error(e);
    return fail(500, "Bid failed.");
  }
}
