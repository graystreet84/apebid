import { NextResponse } from "next/server";
import { emptyStatePayload, readStore } from "@/lib/store";
import { rankListings } from "@/lib/ranking";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await readStore();
    const listings = rankListings(store.listings);
    const revenueUnits = store.listings.reduce((s, l) => s + (l.paidUnits || 0), 0);
    return NextResponse.json({
      listings,
      count: listings.length,
      revenueSol: revenueUnits / 100,
      revenueUnits,
    });
  } catch (err) {
    console.error("/api/ranking failed", err);
    const empty = emptyStatePayload();
    return NextResponse.json({
      listings: empty.listings,
      count: 0,
      revenueSol: empty.revenueSol,
      revenueUnits: empty.revenueUnits,
    });
  }
}
