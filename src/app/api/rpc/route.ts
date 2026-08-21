import { NextResponse } from "next/server";
import {
  clientIp,
  isAllowedRpcMethod,
  isRetryableUpstreamStatus,
  isAllowedSiteRequest,
  rpcBurstLimited,
  rpcUpstreamHost,
  serverRpcCandidates,
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
  if (!isAllowedSiteRequest(req)) {
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

  const payload = JSON.stringify({
    jsonrpc: body.jsonrpc ?? "2.0",
    id: body.id ?? 1,
    method: body.method,
    params: body.params ?? [],
  });

  const candidates = serverRpcCandidates();
  let lastHost = "unknown";

  for (let i = 0; i < candidates.length; i += 1) {
    const upstream = candidates[i];
    const host = rpcUpstreamHost(upstream);
    lastHost = host;
    const isLast = i === candidates.length - 1;
    try {
      const upstreamRes = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      if (!isLast && isRetryableUpstreamStatus(upstreamRes.status)) {
        console.error("/api/rpc upstream retryable", host, upstreamRes.status);
        continue;
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
    } catch (err) {
      console.error("/api/rpc upstream failed", host, err);
      if (isLast) break;
    }
  }

  return fail(502, `Upstream RPC failed (${lastHost}).`, body.id ?? null);
}
