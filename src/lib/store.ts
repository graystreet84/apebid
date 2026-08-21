import fs from "fs";
import path from "path";
import { createClient, type Client, type InStatement, type Row } from "@libsql/client";
import type { Activity, Listing, StoreData, VisitorStats } from "./types";
import {
  isNeonUniqueError,
  neonEnsureReady,
  neonGetMeta,
  neonLoad,
  neonPersist,
  neonRevenueStats,
  neonSetMeta,
  neonUrl,
  neonUpsertVisitor,
  neonVisitorStats,
} from "./storeNeon";

const LOCAL_REL = path.join("data", "apebid.db");

let client: Client | null = null;
let ready: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let backend: "unset" | "neon" | "libsql" | "empty" = "unset";
let fileStoreOk: boolean | null = null;

function isServerless(): boolean {
  if (process.env.VERCEL) return true;
  const env = process.env.VERCEL_ENV;
  return env === "production" || env === "preview";
}

function hasHostedLibsql(): boolean {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  return Boolean(url && token && !url.startsWith("file:"));
}

function hostedLibsqlUrl(): string | null {
  if (!hasHostedLibsql()) return null;
  return process.env.TURSO_DATABASE_URL!.trim();
}

function isDurableBackend(): boolean {
  return backend === "neon" || backend === "libsql";
}

function canUseFileStore(): boolean {
  // Serverless / Vercel function FS cannot persist a local sqlite file.
  if (isServerless()) return false;
  if (fileStoreOk != null) return fileStoreOk;
  try {
    const abs = path.isAbsolute(LOCAL_REL)
      ? LOCAL_REL
      : path.join(process.cwd(), LOCAL_REL);
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    fileStoreOk = true;
  } catch {
    fileStoreOk = false;
  }
  return fileStoreOk;
}

export class SignatureUsedError extends Error {
  constructor() {
    super("That signature was already used.");
    this.name = "SignatureUsedError";
  }
}

export class StoreUnavailableError extends Error {
  constructor(message = "Board store is unavailable.") {
    super(message);
    this.name = "StoreUnavailableError";
  }
}

function markEmpty(reason: unknown): void {
  backend = "empty";
  client = null;
  const detail = reason instanceof Error ? reason.message : String(reason);
  console.warn("apebid store: durable store unavailable:", detail);
}

function emptyStoreData(): StoreData {
  return {
    listings: [],
    activity: [],
    usedSignatures: [],
    usedSigs: [],
  };
}

function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = chain.then(() => fn());
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function num(v: unknown, d = 0): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function str(v: unknown, d = ""): string {
  if (v == null) return d;
  return String(v);
}

function optStr(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  return String(v);
}

function optNum(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : undefined;
}

function localFileUrl(): string {
  const abs = path.isAbsolute(LOCAL_REL)
    ? LOCAL_REL
    : path.join(process.cwd(), LOCAL_REL);
  return `file:${abs}`;
}

function dbUrl(): string | null {
  const hosted = hostedLibsqlUrl();
  if (hosted) return hosted;
  if (canUseFileStore()) return localFileUrl();
  return null;
}

export function hostedStoreConfigured(): boolean {
  return Boolean(neonUrl() || hostedLibsqlUrl());
}

export function durableStoreConfigured(): boolean {
  if (hostedStoreConfigured()) return true;
  return canUseFileStore();
}

function isHostedDeploy(): boolean {
  return Boolean(process.env.VERCEL) ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";
}

/** Real paid bids require a hosted DB on Vercel. File sqlite is local/dev only. */
export function canAcceptPaidBid(): boolean {
  if (isHostedDeploy()) return hostedStoreConfigured();
  return durableStoreConfigured();
}

function getClient(): Client {
  if (client) return client;
  const url = dbUrl();
  if (!url) {
    throw new Error("No durable store URL");
  }
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
  }
  client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  return client;
}

async function ensureSchema(c: Client): Promise<void> {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      mint TEXT,
      clickUrl TEXT,
      ticker TEXT,
      name TEXT,
      tagline TEXT,
      bidUnits INTEGER NOT NULL DEFAULT 0,
      paidUnits INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0,
      identityType TEXT,
      display TEXT,
      url TEXT,
      bidSol REAL,
      wallet TEXT,
      lastTxSig TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      listingId TEXT,
      identity TEXT,
      ticker TEXT,
      name TEXT,
      rank INTEGER,
      bidUnits INTEGER,
      paidUnits INTEGER,
      kind TEXT,
      createdAt TEXT,
      type TEXT,
      display TEXT,
      bidSol REAL,
      paidSol REAL,
      at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS used_signatures (
      signature TEXT PRIMARY KEY
    )`,
    `CREATE TABLE IF NOT EXISTS visitors (
      id TEXT PRIMARY KEY,
      firstSeen TEXT NOT NULL,
      lastSeen TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )`,
  ];
  for (const sql of stmts) {
    await c.execute(sql);
  }
}

function listingFromJson(raw: Record<string, unknown>): Listing {
  return {
    id: str(raw.id),
    identity: str(raw.identity),
    mint: str(raw.mint),
    clickUrl: str(raw.clickUrl || raw.url),
    ticker: str(raw.ticker),
    name: str(raw.name),
    tagline: str(raw.tagline),
    bidUnits: num(raw.bidUnits, Math.round(num(raw.bidSol) * 100)),
    paidUnits: num(raw.paidUnits, Math.round(num(raw.paidSol) * 100)),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt || raw.createdAt),
    clicks: num(raw.clicks),
    identityType: optStr(raw.identityType) as Listing["identityType"],
    display: optStr(raw.display),
    url: optStr(raw.url),
    bidSol: optNum(raw.bidSol),
    wallet: optStr(raw.wallet),
    lastTxSig: optStr(raw.lastTxSig),
  };
}

function activityFromJson(raw: Record<string, unknown>): Activity {
  return {
    id: str(raw.id),
    listingId: str(raw.listingId),
    identity: str(raw.identity),
    ticker: str(raw.ticker),
    name: str(raw.name),
    rank: num(raw.rank),
    bidUnits: num(raw.bidUnits, Math.round(num(raw.bidSol) * 100)),
    paidUnits: num(raw.paidUnits, Math.round(num(raw.paidSol) * 100)),
    kind: (str(raw.kind || raw.type, "new") === "raise" ? "raise" : "new") as Activity["kind"],
    createdAt: str(raw.createdAt || raw.at),
    type: optStr(raw.type) as Activity["type"],
    display: optStr(raw.display),
    bidSol: optNum(raw.bidSol),
    paidSol: optNum(raw.paidSol),
    at: optStr(raw.at),
  };
}

async function importJsonIfNeeded(c: Client): Promise<void> {
  const flag = await c.execute("SELECT value FROM meta WHERE key = 'importedJson'");
  if (flag.rows.length) return;

  const candidates = [
    path.join(process.cwd(), "data", "store.json"),
    "/workspace/apebid/data/store.json",
  ];
  let raw: string | null = null;
  for (const p of candidates) {
    try {
      raw = fs.readFileSync(p, "utf8");
      break;
    } catch {
      /* next */
    }
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        listings?: Record<string, unknown>[];
        activity?: Record<string, unknown>[];
        usedSignatures?: string[];
        usedSigs?: string[];
      };
      const listings = (parsed.listings || []).map(listingFromJson);
      const activity = (parsed.activity || []).map(activityFromJson);
      const used = parsed.usedSignatures ?? parsed.usedSigs ?? [];
      const stmts: InStatement[] = [];
      for (const l of listings) stmts.push(listingUpsert(l));
      for (const a of activity) stmts.push(activityUpsert(a));
      for (const sig of used) {
        stmts.push({
          sql: "INSERT OR IGNORE INTO used_signatures (signature) VALUES (?)",
          args: [sig],
        });
      }
      if (stmts.length) await c.batch(stmts, "write");
    } catch (err) {
      console.error("store.json import failed", err);
    }
  }

  await c.execute({
    sql: "INSERT OR IGNORE INTO meta (key, value) VALUES ('importedJson', ?)",
    args: ["1"],
  });
}

async function ensureLaunchedAt(c: Client): Promise<void> {
  const existing = await c.execute("SELECT value FROM meta WHERE key = 'launchedAt'");
  if (existing.rows.length && existing.rows[0].value) return;
  const earliest = await c.execute(
    "SELECT createdAt FROM listings ORDER BY createdAt ASC LIMIT 1"
  );
  const launchedAt =
    earliest.rows[0]?.createdAt != null
      ? str(earliest.rows[0].createdAt)
      : new Date().toISOString();
  await c.execute({
    sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('launchedAt', ?)",
    args: [launchedAt],
  });
}

async function init(): Promise<void> {
  if (backend === "neon" || backend === "libsql") return;
  if (backend === "empty") {
    if (neonUrl() || hostedLibsqlUrl() || canUseFileStore()) {
      ready = null;
      backend = "unset";
    } else {
      return;
    }
  }
  if (!ready) {
    ready = (async () => {
      if (neonUrl()) {
        try {
          await neonEnsureReady();
          backend = "neon";
          return;
        } catch (err) {
          markEmpty(err);
          return;
        }
      }
      if (!dbUrl()) {
        markEmpty("no hosted database and filesystem is not writable");
        return;
      }
      try {
        const c = getClient();
        await ensureSchema(c);
        await importJsonIfNeeded(c);
        await ensureLaunchedAt(c);
        backend = "libsql";
      } catch (err) {
        client = null;
        markEmpty(err);
      }
    })();
  }
  return ready;
}

export async function isDurableStoreReady(): Promise<boolean> {
  await init();
  return isDurableBackend();
}

function listingFromRow(row: Row): Listing {
  return {
    id: str(row.id),
    identity: str(row.identity),
    mint: str(row.mint),
    clickUrl: str(row.clickUrl),
    ticker: str(row.ticker),
    name: str(row.name),
    tagline: str(row.tagline),
    bidUnits: num(row.bidUnits),
    paidUnits: num(row.paidUnits),
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
    clicks: num(row.clicks),
    identityType: optStr(row.identityType) as Listing["identityType"],
    display: optStr(row.display),
    url: optStr(row.url),
    bidSol: optNum(row.bidSol),
    wallet: optStr(row.wallet),
    lastTxSig: optStr(row.lastTxSig),
  };
}

function activityFromRow(row: Row): Activity {
  return {
    id: str(row.id),
    listingId: str(row.listingId),
    identity: str(row.identity),
    ticker: str(row.ticker),
    name: str(row.name),
    rank: num(row.rank),
    bidUnits: num(row.bidUnits),
    paidUnits: num(row.paidUnits),
    kind: (str(row.kind, "new") === "raise" ? "raise" : "new") as Activity["kind"],
    createdAt: str(row.createdAt),
    type: optStr(row.type) as Activity["type"],
    display: optStr(row.display),
    bidSol: optNum(row.bidSol),
    paidSol: optNum(row.paidSol),
    at: optStr(row.at),
  };
}

function listingUpsert(l: Listing): InStatement {
  return {
    sql: `INSERT INTO listings (
        id, identity, mint, clickUrl, ticker, name, tagline,
        bidUnits, paidUnits, createdAt, updatedAt, clicks,
        identityType, display, url, bidSol, wallet, lastTxSig
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        identity=excluded.identity,
        mint=excluded.mint,
        clickUrl=excluded.clickUrl,
        ticker=excluded.ticker,
        name=excluded.name,
        tagline=excluded.tagline,
        bidUnits=excluded.bidUnits,
        paidUnits=excluded.paidUnits,
        updatedAt=excluded.updatedAt,
        clicks=excluded.clicks,
        identityType=excluded.identityType,
        display=excluded.display,
        url=excluded.url,
        bidSol=excluded.bidSol,
        wallet=excluded.wallet,
        lastTxSig=excluded.lastTxSig`,
    args: [
      l.id,
      l.identity,
      l.mint ?? "",
      l.clickUrl ?? "",
      l.ticker ?? "",
      l.name ?? "",
      l.tagline ?? "",
      l.bidUnits ?? 0,
      l.paidUnits ?? 0,
      l.createdAt,
      l.updatedAt,
      l.clicks ?? 0,
      l.identityType ?? null,
      l.display ?? null,
      l.url ?? null,
      l.bidSol ?? null,
      l.wallet ?? null,
      l.lastTxSig ?? null,
    ],
  };
}

function activityUpsert(a: Activity): InStatement {
  return {
    sql: `INSERT INTO activity (
        id, listingId, identity, ticker, name, rank,
        bidUnits, paidUnits, kind, createdAt, type, display, bidSol, paidSol, at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        listingId=excluded.listingId,
        identity=excluded.identity,
        ticker=excluded.ticker,
        name=excluded.name,
        rank=excluded.rank,
        bidUnits=excluded.bidUnits,
        paidUnits=excluded.paidUnits,
        kind=excluded.kind,
        createdAt=excluded.createdAt,
        type=excluded.type,
        display=excluded.display,
        bidSol=excluded.bidSol,
        paidSol=excluded.paidSol,
        at=excluded.at`,
    args: [
      a.id,
      a.listingId ?? "",
      a.identity ?? "",
      a.ticker ?? "",
      a.name ?? "",
      a.rank ?? 0,
      a.bidUnits ?? 0,
      a.paidUnits ?? 0,
      a.kind ?? "new",
      a.createdAt,
      a.type ?? null,
      a.display ?? null,
      a.bidSol ?? null,
      a.paidSol ?? null,
      a.at ?? null,
    ],
  };
}

function isUniqueError(err: unknown): boolean {
  if (isNeonUniqueError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|already exists|constraint/i.test(msg);
}

async function loadData(): Promise<StoreData> {
  await init();
  if (backend === "neon") {
    try {
      return await neonLoad();
    } catch (err) {
      markEmpty(err);
      return emptyStoreData();
    }
  }
  if (backend !== "libsql") return emptyStoreData();
  try {
    const c = getClient();
    const [listingsRes, activityRes, sigsRes] = await Promise.all([
      c.execute("SELECT * FROM listings"),
      c.execute("SELECT * FROM activity ORDER BY createdAt DESC"),
      c.execute("SELECT signature FROM used_signatures"),
    ]);
    const used = sigsRes.rows.map((r) => str(r.signature));
    return {
      listings: listingsRes.rows.map(listingFromRow),
      activity: activityRes.rows.map(activityFromRow),
      usedSignatures: used,
      usedSigs: used,
    };
  } catch (err) {
    markEmpty(err);
    return emptyStoreData();
  }
}

async function persist(prev: StoreData, next: StoreData): Promise<void> {
  const used = next.usedSignatures ?? next.usedSigs ?? [];
  next.usedSignatures = used;
  next.usedSigs = used;
  if (!isDurableBackend()) {
    throw new StoreUnavailableError();
  }

  try {
    if (backend === "neon") {
      await neonPersist(prev, next);
      return;
    }
    const c = getClient();
    const stmts: InStatement[] = [];
    const nextListingIds = new Set(next.listings.map((l) => l.id));
    for (const l of prev.listings) {
      if (!nextListingIds.has(l.id)) {
        stmts.push({ sql: "DELETE FROM listings WHERE id = ?", args: [l.id] });
      }
    }
    for (const l of next.listings) stmts.push(listingUpsert(l));

    const nextActIds = new Set(next.activity.map((a) => a.id));
    for (const a of prev.activity) {
      if (!nextActIds.has(a.id)) {
        stmts.push({ sql: "DELETE FROM activity WHERE id = ?", args: [a.id] });
      }
    }
    for (const a of next.activity) stmts.push(activityUpsert(a));

    const prevSigs = new Set(prev.usedSignatures ?? prev.usedSigs ?? []);
    for (const sig of used) {
      if (!prevSigs.has(sig)) {
        stmts.push({
          sql: "INSERT INTO used_signatures (signature) VALUES (?)",
          args: [sig],
        });
      }
    }

    if (!stmts.length) return;
    await c.batch(stmts, "write");
  } catch (err) {
    if (isUniqueError(err)) throw new SignatureUsedError();
    markEmpty(err);
    throw new StoreUnavailableError();
  }
}

export function readStore(): Promise<StoreData> {
  return withLock(() => loadData());
}

export function updateStore<T>(
  fn: (data: StoreData) => Promise<T> | T
): Promise<T> {
  return withLock(async () => {
    const data = await loadData();
    const prev: StoreData = {
      listings: data.listings.slice(),
      activity: data.activity.slice(),
      usedSignatures: (data.usedSignatures ?? []).slice(),
      usedSigs: (data.usedSignatures ?? []).slice(),
    };
    const result = await fn(data);
    await persist(prev, data);
    return result;
  });
}

export const loadStore = readStore;
export const mutateStore = updateStore;

export function withStore<T>(
  fn: (data: StoreData) => Promise<T> | T
): Promise<T> {
  return withLock(async () => fn(await loadData()));
}

export async function upsertVisitor(id: string): Promise<void> {
  if (!id) return;
  return withLock(async () => {
    await init();
    if (!isDurableBackend()) return;
    const now = new Date().toISOString();
    try {
      if (backend === "neon") {
        await neonUpsertVisitor(id, now);
        return;
      }
      const c = getClient();
      await c.execute({
        sql: `INSERT INTO visitors (id, firstSeen, lastSeen) VALUES (?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET lastSeen = excluded.lastSeen`,
        args: [id, now, now],
      });
    } catch (err) {
      markEmpty(err);
    }
  });
}

export async function visitorStats(): Promise<VisitorStats> {
  await init();
  if (!isDurableBackend()) {
    return {
      live: 0,
      last12h: 0,
      sinceLaunch: 0,
      launchedAt: new Date().toISOString(),
    };
  }
  try {
    if (backend === "neon") return await neonVisitorStats();
    const c = getClient();
    const now = Date.now();
    const liveCutoff = new Date(now - 120_000).toISOString();
    const h12Cutoff = new Date(now - 12 * 3600 * 1000).toISOString();
    const [live, last12h, total, launched] = await Promise.all([
      c.execute({
        sql: "SELECT COUNT(*) AS n FROM visitors WHERE lastSeen >= ?",
        args: [liveCutoff],
      }),
      c.execute({
        sql: "SELECT COUNT(*) AS n FROM visitors WHERE lastSeen >= ?",
        args: [h12Cutoff],
      }),
      c.execute("SELECT COUNT(*) AS n FROM visitors"),
      c.execute("SELECT value FROM meta WHERE key = 'launchedAt'"),
    ]);
    return {
      live: num(live.rows[0]?.n),
      last12h: num(last12h.rows[0]?.n),
      sinceLaunch: num(total.rows[0]?.n),
      launchedAt: str(launched.rows[0]?.value, new Date().toISOString()),
    };
  } catch (err) {
    markEmpty(err);
    return {
      live: 0,
      last12h: 0,
      sinceLaunch: 0,
      launchedAt: new Date().toISOString(),
    };
  }
}

export async function revenueStats(): Promise<{
  revenueUnits: number;
  revenueSol: number;
}> {
  await init();
  if (!isDurableBackend()) return { revenueUnits: 0, revenueSol: 0 };
  try {
    if (backend === "neon") return await neonRevenueStats();
    const c = getClient();
    const r = await c.execute(
      "SELECT COALESCE(SUM(paidUnits), 0) AS n FROM listings"
    );
    const revenueUnits = num(r.rows[0]?.n);
    return { revenueUnits, revenueSol: revenueUnits / 100 };
  } catch (err) {
    markEmpty(err);
    return { revenueUnits: 0, revenueSol: 0 };
  }
}

export function emptyStats(): VisitorStats & {
  revenueUnits: number;
  revenueSol: number;
} {
  return {
    live: 0,
    last12h: 0,
    sinceLaunch: 0,
    launchedAt: "",
    revenueUnits: 0,
    revenueSol: 0,
  };
}

export function emptyStatePayload() {
  const launchedAt = new Date().toISOString();
  return {
    listings: [] as Listing[],
    activity: [] as Activity[],
    events: [] as Activity[],
    count: 0,
    revenueUnits: 0,
    revenueSol: 0,
    live: 0,
    last12h: 0,
    sinceLaunch: 0,
    launchedAt,
    visitors: {
      live: 0,
      last12h: 0,
      sinceLaunch: 0,
      launchedAt,
    },
  };
}


export async function getMeta(key: string): Promise<string | null> {
  await init();
  if (!isDurableBackend()) return null;
  try {
    if (backend === "neon") return await neonGetMeta(key);
    const c = getClient();
    const r = await c.execute({
      sql: "SELECT value FROM meta WHERE key = ?",
      args: [key],
    });
    if (!r.rows.length || r.rows[0].value == null) return null;
    return str(r.rows[0].value);
  } catch (err) {
    markEmpty(err);
    return null;
  }
}

export async function setMeta(key: string, value: string): Promise<void> {
  await init();
  if (!isDurableBackend()) return;
  try {
    if (backend === "neon") {
      await neonSetMeta(key, value);
      return;
    }
    const c = getClient();
    await c.execute({
      sql: "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
      args: [key, value],
    });
  } catch (err) {
    markEmpty(err);
  }
}
