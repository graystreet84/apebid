import { NextResponse } from "next/server";
import {
  clientIp,
  isAllowedRpcMethod,
  isSameOriginRequest,
  rpcBurstLimited,
  rpcUpstreamHost,
  serverRpcUrl,
} from "@/lib/rpc";

export const dynamic = "force-dynamic";

type JsonRpcBody = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

function fail(status: number, error: string, id: unknown = null) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      error: { code: status, message: error },
      id,
    },
    {
      status,
      headers: { "x-apebid-rpc-host": rpcUpstreamHost() },
    }
  );
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return fail(403, "RPC proxy is same-origin only.");
  }

  const ip = clientIp(req);
  if (rpcBurstLimited(ip)) {
    return fail(429, "Too many RPC requests.");
  }

  let body: JsonRpcBody;
  try {
    body = (await req.json()) as JsonRpcBody;
  } catch {
    return fail(400, "Bad JSON-RPC body.");
  }

  if (Array.isArray(body)) {
    return fail(400, "JSON-RPC batches are not allowed.");
  }

  if (!isAllowedRpcMethod(body.method)) {
    return fail(403, "RPC method is not allowed.", body.id ?? null);
  }

  const upstream = serverRpcUrl();
  const host = rpcUpstreamHost(upstream);
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: body.jsonrpc ?? "2.0",
        id: body.id ?? 1,
        method: body.method,
        params: body.params ?? [],
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (err) {
    console.error("/api/rpc upstream failed", host, err);
    return fail(502, `Upstream RPC failed (${host}).`, body.id ?? null);
  }

  const text = await upstreamRes.text();
  return new NextResponse(text, {
    status: upstreamRes.status,
    headers: {
      "Content-Type":
        upstreamRes.headers.get("content-type") || "application/json",
      "x-apebid-rpc-host": host,
      "Cache-Control": "no-store",
    },
  });
}
