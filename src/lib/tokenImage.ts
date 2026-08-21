import { getMeta, setMeta } from "./store";

const HIT_TTL_MS = 60 * 60 * 1000;
const MISS_TTL_MS = 5 * 60 * 1000;
const FETCH_MS = 2500;

type CacheEntry = { url: string | null; exp: number };

const mem = new Map<string, CacheEntry>();

const IMAGE_HOSTS = new Set([
  "ipfs.io",
  "cloudflare-ipfs.com",
  "cf-ipfs.com",
  "nftstorage.link",
  "arweave.net",
  "pump.fun",
  "dexscreener.com",
  "dd.dexscreener.com",
  "cdn.dexscreener.com",
  "images.dexscreener.com",
  "pinata.cloud",
  "gateway.pinata.cloud",
  "w3s.link",
]);

const IMAGE_HOST_SUFFIXES = [
  ".ipfs.io",
  ".nftstorage.link",
  ".arweave.net",
  ".pump.fun",
  ".dexscreener.com",
  ".pinata.cloud",
  ".mypinata.cloud",
];

export function isAllowedImageHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (IMAGE_HOSTS.has(h)) return true;
  if (h.startsWith("www.") && IMAGE_HOSTS.has(h.slice(4))) return true;
  return IMAGE_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

export function httpsImageUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s.startsWith("https://")) return null;
  if (s.length > 2000) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!isAllowedImageHost(url.hostname)) return null;
    return s;
  } catch {
    return null;
  }
}

function httpUrl(v: unknown): string | null {
  return httpsImageUrl(v);
}

function pickPumpImage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  return (
    httpUrl(o.image_uri) ||
    httpUrl(o.imageUri) ||
    httpUrl(o.image) ||
    httpUrl(o.image_url) ||
    httpUrl(o.imageUrl) ||
    null
  );
}

function pickDexPair(pair: unknown): string | null {
  if (!pair || typeof pair !== "object") return null;
  const o = pair as Record<string, unknown>;
  const info = o.info;
  if (info && typeof info === "object") {
    const img = httpUrl((info as Record<string, unknown>).imageUrl);
    if (img) return img;
  }
  return httpUrl(o.imageUrl) || httpUrl(o.image_url);
}

function pickDexImage(data: unknown): string | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    for (const row of data) {
      const img = pickDexPair(row);
      if (img) return img;
    }
    return null;
  }
  if (typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const pairs = o.pairs;
  if (Array.isArray(pairs)) {
    for (const row of pairs) {
      const img = pickDexPair(row);
      if (img) return img;
    }
  }
  return pickDexPair(o) || pickPumpImage(o);
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function readDisk(mint: string): Promise<CacheEntry | null> {
  try {
    const raw = await getMeta(`img:${mint}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed.exp !== "number") return null;
    if (parsed.url !== null && !httpUrl(parsed.url)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeDisk(mint: string, entry: CacheEntry): Promise<void> {
  try {
    await setMeta(`img:${mint}`, JSON.stringify(entry));
  } catch {
    /* cache write is optional */
  }
}

async function resolveRemote(mint: string): Promise<string | null> {
  const pump = await fetchJson(
    `https://frontend-api-v3.pump.fun/coins/${encodeURIComponent(mint)}`
  );
  const fromPump = pickPumpImage(pump);
  if (fromPump) return fromPump;

  const dexV1 = await fetchJson(
    `https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`
  );
  const fromV1 = pickDexImage(dexV1);
  if (fromV1) return fromV1;

  const dexLatest = await fetchJson(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`
  );
  return pickDexImage(dexLatest);
}

export async function getTokenImage(mint: string): Promise<string | null> {
  try {
    const key = String(mint || "").trim();
    if (key.length < 32 || key.length > 48) return null;

    const now = Date.now();
    const hit = mem.get(key);
    if (hit && hit.exp > now) return hit.url;

    const disk = await readDisk(key);
    if (disk && disk.exp > now) {
      mem.set(key, disk);
      return disk.url;
    }

    const url = await resolveRemote(key);
    const entry: CacheEntry = {
      url,
      exp: now + (url ? HIT_TTL_MS : MISS_TTL_MS),
    };
    mem.set(key, entry);
    await writeDisk(key, entry);
    return url;
  } catch {
    return null;
  }
}

export async function getTokenImages(
  mints: string[]
): Promise<Record<string, string | null>> {
  const unique = [...new Set(mints.map((m) => String(m || "").trim()).filter(Boolean))];
  const out: Record<string, string | null> = {};
  await Promise.all(
    unique.map(async (m) => {
      out[m] = await getTokenImage(m);
    })
  );
  return out;
}
