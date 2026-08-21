import { NextResponse } from "next/server";
import { isDurableStoreReady, updateStore } from "./store";
import { isAllowedClickUrl } from "./validate";

export async function redirectListingClick(id: string): Promise<NextResponse> {
  if (!(await isDurableStoreReady())) {
    return NextResponse.json({ error: "not on the board" }, { status: 404 });
  }

  type Result =
    | { status: "ok"; url: string }
    | { status: "missing" }
    | { status: "bad" };

  let result: Result;
  try {
    result = await updateStore((store): Result => {
      const row = store.listings.find((l) => l.id === id);
      if (!row) return { status: "missing" };
      if (!isAllowedClickUrl(row.clickUrl)) return { status: "bad" };
      row.clicks += 1;
      return { status: "ok", url: row.clickUrl };
    });
  } catch {
    return NextResponse.json({ error: "not on the board" }, { status: 404 });
  }

  if (result.status === "bad") {
    return NextResponse.json({ error: "invalid destination" }, { status: 400 });
  }
  if (result.status !== "ok") {
    return NextResponse.json({ error: "not on the board" }, { status: 404 });
  }
  return NextResponse.redirect(result.url, 302);
}
