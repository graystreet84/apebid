import { NextResponse } from "next/server";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const url = await updateStore((store) => {
    const row = store.listings.find((l) => l.id === id);
    if (!row) return null;
    row.clicks += 1;
    return row.clickUrl;
  });
  if (!url) {
    return NextResponse.json({ error: "not on the board" }, { status: 404 });
  }
  return NextResponse.redirect(url, 302);
}
