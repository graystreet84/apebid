import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import { rankListings } from "@/lib/ranking";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = await readStore();
  const listings = rankListings(store.listings);
  const revenueUnits = store.listings.reduce((s, l) => s + (l.paidUnits || 0), 0);
  return NextResponse.json({
    listings,
    count: listings.length,
    revenueSol: revenueUnits / 100,
    revenueUnits,
  });
}
