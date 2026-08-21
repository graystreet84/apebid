import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import { unitsToSol } from "@/lib/types";

export const dynamic = "force-dynamic";

function decorate(a: {
  id: string;
  kind?: string;
  type?: string;
  ticker?: string;
  name?: string;
  identity?: string;
  display?: string;
  rank: number;
  bidUnits?: number;
  paidUnits?: number;
  bidSol?: number;
  paidSol?: number;
  createdAt?: string;
  at?: string;
}) {
  const bidUnits = a.bidUnits ?? Math.round((a.bidSol ?? 0) * 100);
  const paidUnits = a.paidUnits ?? Math.round((a.paidSol ?? 0) * 100);
  const kind = a.kind || (a.type === "raise" ? "raise" : "new");
  return {
    ...a,
    type: a.type || (kind === "raise" ? "raise" : "bid"),
    kind,
    display: a.display || a.ticker || a.name || a.identity || "",
    bidUnits,
    paidUnits,
    bidSol: a.bidSol ?? unitsToSol(bidUnits),
    paidSol: a.paidSol ?? unitsToSol(paidUnits),
    createdAt: a.createdAt || a.at || new Date().toISOString(),
    at: a.at || a.createdAt || new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const store = await readStore();
    const events = [...(store.activity || [])]
      .sort(
        (a, b) =>
          new Date(b.createdAt || b.at || 0).getTime() -
          new Date(a.createdAt || a.at || 0).getTime()
      )
      .slice(0, 40)
      .map(decorate);
    return NextResponse.json({ events, activity: events });
  } catch (err) {
    console.error("/api/activity failed", err);
    return NextResponse.json({ events: [], activity: [] });
  }
}
