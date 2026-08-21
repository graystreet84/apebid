import { NextResponse } from "next/server";
import { emptyStatePayload, revenueStats } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await revenueStats();
    return NextResponse.json({
      revenueUnits: stats.revenueUnits,
      revenueSol: stats.revenueSol,
    });
  } catch (err) {
    console.error("/api/revenue failed", err);
    const empty = emptyStatePayload();
    return NextResponse.json({
      revenueUnits: empty.revenueUnits,
      revenueSol: empty.revenueSol,
    });
  }
}
