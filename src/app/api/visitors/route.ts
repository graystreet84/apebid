import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { upsertVisitor, visitorStats } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
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
}
