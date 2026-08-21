export const PUBLIC_FALLBACK_RPC = "https://solana-rpc.publicnode.com";
export const BLOCKED_OFFICIAL_RPC = "https://api.mainnet-beta.solana.com";

export const ALLOWED_RPC_METHODS = [
  "getLatestBlockhash",
  "getRecentBlockhash",
  "getSignatureStatuses",
  "getSignatureStatus",
  "sendTransaction",
  "getParsedTransaction",
  "getTransaction",
  "getRecentPrioritizationFees",
  "simulateTransaction",
  "getBlockHeight",
  "getFeeForMessage",
] as const;

const ALLOWED = new Set<string>(ALLOWED_RPC_METHODS);

export function isAllowedRpcMethod(method: unknown): method is string {
  return typeof method === "string" && ALLOWED.has(method);
}

export function isBlockedOfficialRpc(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === "api.mainnet-beta.solana.com";
  } catch {
    return false;
  }
}

function firstAbsoluteRpc(
  ...candidates: (string | undefined)[]
): string | null {
  for (const raw of candidates) {
    const url = raw?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (isBlockedOfficialRpc(url)) continue;
    return url;
  }
  return null;
}

/** Server-side RPC only. Paid keys belong in SOLANA_RPC, never NEXT_PUBLIC_*. */
export function serverRpcUrl(): string {
  return (
    firstAbsoluteRpc(process.env.SOLANA_RPC, process.env.NEXT_PUBLIC_SOLANA_RPC) ||
    PUBLIC_FALLBACK_RPC
  );
}

export function rpcUpstreamHost(url = serverRpcUrl()): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

export function requestOrigin(req: Request): string {
  const incoming = new URL(req.url);
  const proto = (
    req.headers.get("x-forwarded-proto") ||
    incoming.protocol.replace(":", "")
  ).split(",")[0].trim();
  const host = (
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    incoming.host
  )
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

export function clientRequestOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }
  const referer = req.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(req: Request): boolean {
  const client = clientRequestOrigin(req);
  if (!client) return false;
  return client === requestOrigin(req);
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 40;

export function rpcBurstLimited(
  key: string,
  now = Date.now(),
  windowMs = WINDOW_MS,
  max = MAX_PER_WINDOW
): boolean {
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 2000) {
      for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k);
      }
    }
    return false;
  }
  existing.count += 1;
  return existing.count > max;
}
