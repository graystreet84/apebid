import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { emptyStatePayload, upsertVisitor, visitorStats } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jar = await cookies();
    const hdrs = await headers();
    const id =
      jar.get("apebid-visitor-id")?.value ||
      hdrs.get("x-apebid-visitor-id") ||
      "";
    if (id) await upsertVisitor(id);
    const stats = await visitorStats();
    return NextResponse.json({
      live: stats.live,
      last12h: stats.last12h,
      sinceLaunch: stats.sinceLaunch,
      launchedAt: stats.launchedAt,
    });
  } catch (err) {
    console.error("/api/visitors failed", err);
    const empty = emptyStatePayload();
    return NextResponse.json({
      live: empty.live,
      last12h: empty.last12h,
      sinceLaunch: empty.sinceLaunch,
      launchedAt: empty.launchedAt,
    });
  }
}
