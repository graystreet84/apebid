import { cookies, headers } from "next/headers";
import { upsertVisitor } from "./store";

export const VISITOR_COOKIE = "apebid-visitor-id";
export const VISITOR_HEADER = "x-apebid-visitor-id";
export const VISITOR_MAX_AGE = 60 * 60 * 24 * 365;

export async function touchVisitor(): Promise<void> {
  try {
    const jar = await cookies();
    const hdrs = await headers();
    const id =
      jar.get(VISITOR_COOKIE)?.value || hdrs.get(VISITOR_HEADER) || "";
    if (id) await upsertVisitor(id);
  } catch {
    /* no request scope / ignore */
  }
}
