import { NextResponse } from "next/server";
import {
  getListingClickUrl,
  incrementListingClicks,
  isDurableStoreReady,
} from "./store";
import { isAllowedClickUrl } from "./validate";

export async function redirectListingClick(id: string): Promise<NextResponse> {
  if (!(await isDurableStoreReady())) {
    return NextResponse.json({ error: "not on the board" }, { status: 404 });
  }

  try {
    const url = await getListingClickUrl(id);
    if (!url) {
      return NextResponse.json({ error: "not on the board" }, { status: 404 });
    }
    if (!isAllowedClickUrl(url)) {
      return NextResponse.json({ error: "invalid destination" }, { status: 400 });
    }
    await incrementListingClicks(id);
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.json({ error: "not on the board" }, { status: 404 });
  }
}
