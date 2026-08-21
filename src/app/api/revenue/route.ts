import { NextResponse } from "next/server";
import { revenueStats } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await revenueStats();
  return NextResponse.json({
    revenueUnits: stats.revenueUnits,
    revenueSol: stats.revenueSol,
  });
}
