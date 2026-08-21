import { NextResponse } from "next/server";
import { getTokenImage } from "@/lib/tokenImage";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await ctx.params;
    const url = await getTokenImage(mint);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ url: null });
  }
}
