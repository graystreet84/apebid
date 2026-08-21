export const OFFICIAL_RPC = "https://api.mainnet-beta.solana.com";
export const PUBLIC_FALLBACK_RPC = "https://solana-rpc.publicnode.com";
/** @deprecated Use OFFICIAL_RPC. Official is the server default; browsers still must not call it. */
export const BLOCKED_OFFICIAL_RPC = OFFICIAL_RPC;

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
  "getBalance",
  "getAccountInfo",
] as const;

const ALLOWED = new Set<string>(ALLOWED_RPC_METHODS);

export function isAllowedRpcMethod(method: unknown): method is string {
  return typeof method === "string" && ALLOWED.has(method);
}

export function isOfficialRpc(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === "api.mainnet-beta.solana.com";
  } catch {
    return false;
  }
}

export function isBlockedOfficialRpc(url: string): boolean {
  return isOfficialRpc(url);
}

function normalizedAbsoluteRpc(raw: string | undefined): string | null {
  const url = raw?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url.replace(/\/$/, "");
}

/**
 * Server-side RPC only. Default is official mainnet-beta.
 * publicnode is last-resort if official fails on the server.
 * Paid keys belong in SOLANA_RPC, never NEXT_PUBLIC_*.
 */
export function serverRpcCandidates(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    const url = normalizedAbsoluteRpc(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  add(process.env.SOLANA_RPC);
  add(OFFICIAL_RPC);
  add(PUBLIC_FALLBACK_RPC);
  return out;
}

export function serverRpcUrl(): string {
  return serverRpcCandidates()[0] || OFFICIAL_RPC;
}

export function isRetryableUpstreamStatus(status: number): boolean {
  return status === 403 || status === 408 || status === 429 || status >= 500;
}

export function rpcUpstreamHost(url = serverRpcUrl()): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

export const ALLOWED_SITE_ORIGINS = [
  "https://apebid.lol",
  "https://www.apebid.lol",
] as const;

function isHostedVercel(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview" ||
    env.VERCEL === "1"
  );
}

export function isAllowedSiteOrigin(
  origin: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const normalized = url.origin;
    if ((ALLOWED_SITE_ORIGINS as readonly string[]).includes(normalized)) {
      return true;
    }
    const host = url.hostname.toLowerCase();
    if (host.endsWith(".vercel.app")) return true;
    if (host === "localhost" || host === "127.0.0.1") {
      return !isHostedVercel(env);
    }
    return false;
  } catch {
    return false;
  }
}

export function isAllowedSiteRequest(req: Request): boolean {
  return isAllowedSiteOrigin(clientRequestOrigin(req));
}

export function requestOrigin(req: Request): string {
  const incoming = new URL(req.url);
  const proto = (
    req.headers.get("x-forwarded-proto") ||
    incoming.protocol.replace(":", "")
  )
    .split(",")[0]
    .trim();
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
  return isAllowedSiteRequest(req);
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
