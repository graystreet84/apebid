import { MIN_UNITS, STEP_UNITS, solToUnits } from "./types";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

const SHORTENERS = [
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
  "lnkd.in",
  "rb.gy",
  "tiny.cc",
  "short.link",
  "s.id",
  "adf.ly",
];

const CHAT_HOSTS = [
  "t.me",
  "telegram.me",
  "telegram.dog",
  "discord.gg",
  "discord.com",
  "discordapp.com",
  "wa.me",
  "api.whatsapp.com",
  "chat.whatsapp.com",
  "whatsapp.com",
  "signal.group",
  "signal.me",
];

const NSFW = [
  "porn",
  "xxx",
  "nsfw",
  "onlyfans",
  "sex",
  "nude",
  "nudes",
  "hentai",
  "adult",
  "xxxvideo",
  "pornhub",
  "xvideos",
  "xhamster",
  "chaturbate",
];

export type ParsedIdentity = {
  identity: string;
  mint: string;
  clickUrl: string;
  url: string;
  type: "ca" | "pump";
  display: string;
};

export type ParseOk = { ok: true; value: ParsedIdentity } & ParsedIdentity;
export type ParseFail = { ok: false; error: string };

function looksLikeMint(s: string): boolean {
  if (s.length < 32 || s.length > 44) return false;
  if (!BASE58.test(s)) return false;
  return true;
}

function hostOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function containsNsfw(text: string): boolean {
  const t = text.toLowerCase();
  return NSFW.some((w) => t.includes(w));
}

function ok(value: ParsedIdentity): ParseOk {
  return { ok: true, value, ...value };
}

export function parseIdentity(raw: string): ParseOk | ParseFail {
  const input = raw.trim();
  if (!input) return { ok: false, error: "Drop a token CA or a pump.fun URL." };
  if (containsNsfw(input)) return { ok: false, error: "NSFW is banned. This is a coin board." };

  const lower = input.toLowerCase();

  if (
    lower.includes("t.me/") ||
    lower.includes("telegram.") ||
    lower.includes("discord.gg") ||
    lower.includes("discord.com/invite") ||
    lower.includes("wa.me/") ||
    lower.includes("whatsapp") ||
    lower.includes("signal.group") ||
    lower.includes("signal.me")
  ) {
    return { ok: false, error: "Chat/invite links are banned. CA or pump.fun URL only." };
  }

  if (looksLikeMint(input)) {
    const clickUrl = `https://solscan.io/token/${input}`;
    return ok({
      identity: input,
      mint: input,
      clickUrl,
      url: clickUrl,
      type: "ca",
      display: input,
    });
  }

  let url: URL;
  try {
    url = new URL(input.startsWith("http") ? input : `https://${input}`);
  } catch {
    return { ok: false, error: "Not a Solana mint and not a pump.fun URL." };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (CHAT_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    return { ok: false, error: "Chat/invite links are banned. CA or pump.fun URL only." };
  }
  if (SHORTENERS.some((h) => host === h || host.endsWith("." + h))) {
    return { ok: false, error: "Link shorteners are banned. Paste the CA or pump.fun URL." };
  }
  if (host !== "pump.fun") {
    return { ok: false, error: "Only a Solana mint address or a pump.fun URL." };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  let mint: string | null = null;
  if (parts.length >= 2 && parts[0] === "coin" && looksLikeMint(parts[1])) {
    mint = parts[1];
  } else if (parts.length >= 1 && looksLikeMint(parts[0])) {
    mint = parts[0];
  }
  if (!mint) {
    return { ok: false, error: "pump.fun URL must include a token mint." };
  }

  const clickUrl = `https://pump.fun/coin/${mint}`;
  return ok({
    identity: mint,
    mint,
    clickUrl,
    url: clickUrl,
    type: "pump",
    display: mint,
  });
}

export function parseBidSol(raw: unknown): { ok: true; units: number } | { ok: false; error: string } {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: "Bid must be a number." };
  const units = solToUnits(n);
  if (Math.abs(n * 100 - units) > 0.001) {
    return { ok: false, error: "Bids are 0.01 SOL increments." };
  }
  if (units < MIN_UNITS) {
    return { ok: false, error: "New spots start at 0.05 SOL." };
  }
  if (units % STEP_UNITS !== 0) {
    return { ok: false, error: "Bids are 0.01 SOL increments." };
  }
  return { ok: true, units };
}

export function sanitizeText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const t = raw.replace(/\s+/g, " ").trim();
  if (containsNsfw(t)) return "";
  return t.slice(0, max);
}

export function hostLooksBanned(raw: string): boolean {
  const host = hostOf(raw);
  if (!host) return false;
  return CHAT_HOSTS.includes(host) || SHORTENERS.includes(host);
}

export function rankForBid(
  listings: { identity: string; bidSol?: number; bidUnits?: number }[],
  identity: string,
  bidSol: number
): number {
  const units = Math.round(bidSol * 100);
  const others = identity
    ? listings.filter((l) => l.identity !== identity)
    : listings;
  let better = 0;
  for (const row of others) {
    const u = row.bidUnits ?? Math.round((row.bidSol ?? 0) * 100);
    if (u >= units) better += 1;
  }
  return better + 1;
}

export function sortListings<T extends { bidUnits?: number; bidSol?: number; createdAt?: string }>(
  listings: T[]
): T[] {
  return [...listings].sort((a, b) => {
    const au = a.bidUnits ?? Math.round((a.bidSol ?? 0) * 100);
    const bu = b.bidUnits ?? Math.round((b.bidSol ?? 0) * 100);
    if (bu !== au) return bu - au;
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return at - bt;
  });
}
