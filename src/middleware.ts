import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "apebid-visitor-id";
const HEADER = "x-apebid-visitor-id";
const YEAR = 60 * 60 * 24 * 365;

export function middleware(req: NextRequest) {
  let id = req.cookies.get(COOKIE)?.value;
  if (!id) id = crypto.randomUUID();

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(HEADER, id);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (!req.cookies.get(COOKIE)?.value) {
    res.cookies.set(COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: YEAR,
      secure: true,
    });
  }
  return res;
}

export const config = {
  matcher: ["/", "/rules", "/api/visitors"],
};
