import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import {
  readStore,
  upsertVisitor,
  visitorStats,
  revenueStats,
  emptyStatePayload,
  StoreUnavailableError,
} from "@/lib/store";
import { rankListings } from "@/lib/ranking";
import { getTokenImages, httpsImageUrl } from "@/lib/tokenImage";

export const dynamic = "force-dynamic";

function failState(status = 503) {
  return NextResponse.json(emptyStatePayload(), { status });
}

export async function GET() {
  try {
    const jar = await cookies();
    const hdrs = await headers();
    const id =
      jar.get("apebid-visitor-id")?.value ||
      hdrs.get("x-apebid-visitor-id") ||
      "";
    if (id) await upsertVisitor(id);

    const [store, visitors, revenue] = await Promise.all([
      readStore(),
      visitorStats(),
      revenueStats(),
    ]);
    const ranked = rankListings(store.listings);
    let listings = ranked;
    try {
      const images = await getTokenImages(ranked.map((l) => l.mint));
      listings = ranked.map((l) => ({
        ...l,
        imageUrl: httpsImageUrl(images[l.mint]) ?? null,
      }));
    } catch {
      listings = ranked.map((l) => ({ ...l, imageUrl: null }));
    }
    const activity = [...store.activity]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 40);
    return NextResponse.json({
      ok: true,
      listings,
      activity,
      revenueUnits: revenue.revenueUnits,
      revenueSol: revenue.revenueSol,
      live: visitors.live,
      last12h: visitors.last12h,
      sinceLaunch: visitors.sinceLaunch,
      launchedAt: visitors.launchedAt,
      visitors,
    });
  } catch (err) {
    console.error("/api/state failed", err);
    const status = err instanceof StoreUnavailableError ? 503 : 500;
    return failState(status);
  }
}
