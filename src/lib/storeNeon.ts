import type { Activity, Listing, StoreData, VisitorStats } from "./types";

type NeonSql = ((
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<Record<string, unknown>[]>) & {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<Record<string, unknown>[]>;
  transaction: (queries: unknown[]) => Promise<unknown>;
};

let sql: NeonSql | null = null;

export function neonUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!/^postgres(ql)?:\/\//i.test(url)) return null;
  return url;
}

async function getSql(): Promise<NeonSql> {
  if (sql) return sql;
  const url = neonUrl();
  if (!url) throw new Error("DATABASE_URL missing");
  const { neon } = await import("@neondatabase/serverless");
  sql = neon(url) as unknown as NeonSql;
  return sql;
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

function listingFromRow(row: Record<string, unknown>): Listing {
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

function activityFromRow(row: Record<string, unknown>): Activity {
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

export function isNeonUniqueError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "23505") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique constraint/i.test(msg);
}

export async function neonEnsureReady(): Promise<void> {
  const db = await getSql();
  await db`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      mint TEXT,
      "clickUrl" TEXT,
      ticker TEXT,
      name TEXT,
      tagline TEXT,
      "bidUnits" INTEGER NOT NULL DEFAULT 0,
      "paidUnits" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0,
      "identityType" TEXT,
      display TEXT,
      url TEXT,
      "bidSol" DOUBLE PRECISION,
      wallet TEXT,
      "lastTxSig" TEXT
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      "listingId" TEXT,
      identity TEXT,
      ticker TEXT,
      name TEXT,
      rank INTEGER,
      "bidUnits" INTEGER,
      "paidUnits" INTEGER,
      kind TEXT,
      "createdAt" TEXT,
      type TEXT,
      display TEXT,
      "bidSol" DOUBLE PRECISION,
      "paidSol" DOUBLE PRECISION,
      at TEXT
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS used_signatures (
      signature TEXT PRIMARY KEY
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS visitors (
      id TEXT PRIMARY KEY,
      "firstSeen" TEXT NOT NULL,
      "lastSeen" TEXT NOT NULL
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS meta (
      "key" TEXT PRIMARY KEY,
      value TEXT
    )
  `;

  const existing = await db`SELECT value FROM meta WHERE "key" = ${"launchedAt"}`;
  if (!existing[0]?.value) {
    const earliest = await db`SELECT "createdAt" FROM listings ORDER BY "createdAt" ASC LIMIT 1`;
    const launchedAt =
      earliest[0]?.createdAt != null
        ? str(earliest[0].createdAt)
        : new Date().toISOString();
    await db`
      INSERT INTO meta ("key", value) VALUES (${"launchedAt"}, ${launchedAt})
      ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value
    `;
  }
  await neonEnsureIdentityUnique();
}

async function neonEnsureIdentityUnique(): Promise<void> {
  try {
    const db = await getSql();
    const dups = await db.query(
      "SELECT identity FROM listings GROUP BY identity HAVING COUNT(*) > 1 LIMIT 1"
    );
    if (dups.length) {
      console.warn("apebid neon: skip UNIQUE(identity), duplicates exist");
      return;
    }
    await db.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS listings_identity_uidx ON listings (identity)"
    );
  } catch (err) {
    console.warn("apebid neon: UNIQUE(identity) not applied", err);
  }
}

export async function neonLoad(): Promise<StoreData> {
  const db = await getSql();
  const [listings, activity, sigs] = await Promise.all([
    db`SELECT * FROM listings`,
    db`SELECT * FROM activity ORDER BY "createdAt" DESC`,
    db`SELECT signature FROM used_signatures`,
  ]);
  const used = sigs.map((r) => str(r.signature));
  return {
    listings: listings.map(listingFromRow),
    activity: activity.map(activityFromRow),
    usedSignatures: used,
    usedSigs: used,
  };
}

function listingUpsertQuery(db: NeonSql, l: Listing) {
  return db`
    INSERT INTO listings (
      id, identity, mint, "clickUrl", ticker, name, tagline,
      "bidUnits", "paidUnits", "createdAt", "updatedAt", clicks,
      "identityType", display, url, "bidSol", wallet, "lastTxSig"
    ) VALUES (
      ${l.id}, ${l.identity}, ${l.mint ?? ""}, ${l.clickUrl ?? ""},
      ${l.ticker ?? ""}, ${l.name ?? ""}, ${l.tagline ?? ""},
      ${l.bidUnits ?? 0}, ${l.paidUnits ?? 0}, ${l.createdAt}, ${l.updatedAt},
      ${l.clicks ?? 0}, ${l.identityType ?? null}, ${l.display ?? null},
      ${l.url ?? null}, ${l.bidSol ?? null}, ${l.wallet ?? null}, ${l.lastTxSig ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      identity = EXCLUDED.identity,
      mint = EXCLUDED.mint,
      "clickUrl" = EXCLUDED."clickUrl",
      ticker = EXCLUDED.ticker,
      name = EXCLUDED.name,
      tagline = EXCLUDED.tagline,
      "bidUnits" = EXCLUDED."bidUnits",
      "paidUnits" = EXCLUDED."paidUnits",
      "updatedAt" = EXCLUDED."updatedAt",
      clicks = EXCLUDED.clicks,
      "identityType" = EXCLUDED."identityType",
      display = EXCLUDED.display,
      url = EXCLUDED.url,
      "bidSol" = EXCLUDED."bidSol",
      wallet = EXCLUDED.wallet,
      "lastTxSig" = EXCLUDED."lastTxSig"
  `;
}

function activityUpsertQuery(db: NeonSql, a: Activity) {
  return db`
    INSERT INTO activity (
      id, "listingId", identity, ticker, name, rank,
      "bidUnits", "paidUnits", kind, "createdAt", type, display, "bidSol", "paidSol", at
    ) VALUES (
      ${a.id}, ${a.listingId ?? ""}, ${a.identity ?? ""}, ${a.ticker ?? ""},
      ${a.name ?? ""}, ${a.rank ?? 0}, ${a.bidUnits ?? 0}, ${a.paidUnits ?? 0},
      ${a.kind ?? "new"}, ${a.createdAt}, ${a.type ?? null}, ${a.display ?? null},
      ${a.bidSol ?? null}, ${a.paidSol ?? null}, ${a.at ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      "listingId" = EXCLUDED."listingId",
      identity = EXCLUDED.identity,
      ticker = EXCLUDED.ticker,
      name = EXCLUDED.name,
      rank = EXCLUDED.rank,
      "bidUnits" = EXCLUDED."bidUnits",
      "paidUnits" = EXCLUDED."paidUnits",
      kind = EXCLUDED.kind,
      "createdAt" = EXCLUDED."createdAt",
      type = EXCLUDED.type,
      display = EXCLUDED.display,
      "bidSol" = EXCLUDED."bidSol",
      "paidSol" = EXCLUDED."paidSol",
      at = EXCLUDED.at
  `;
}

export async function neonPersist(prev: StoreData, next: StoreData): Promise<void> {
  const db = await getSql();
  const used = next.usedSignatures ?? next.usedSigs ?? [];
  const queries: unknown[] = [];

  const nextListingIds = new Set(next.listings.map((l) => l.id));
  for (const l of prev.listings) {
    if (!nextListingIds.has(l.id)) {
      queries.push(db`DELETE FROM listings WHERE id = ${l.id}`);
    }
  }
  for (const l of next.listings) queries.push(listingUpsertQuery(db, l));

  const nextActIds = new Set(next.activity.map((a) => a.id));
  for (const a of prev.activity) {
    if (!nextActIds.has(a.id)) {
      queries.push(db`DELETE FROM activity WHERE id = ${a.id}`);
    }
  }
  for (const a of next.activity) queries.push(activityUpsertQuery(db, a));

  const prevSigs = new Set(prev.usedSignatures ?? prev.usedSigs ?? []);
  for (const sig of used) {
    if (!prevSigs.has(sig)) {
      queries.push(db`INSERT INTO used_signatures (signature) VALUES (${sig})`);
    }
  }

  if (!queries.length) return;
  await db.transaction(queries);
}

export async function neonUpsertVisitor(id: string, now: string): Promise<void> {
  const db = await getSql();
  await db`
    INSERT INTO visitors (id, "firstSeen", "lastSeen") VALUES (${id}, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET "lastSeen" = EXCLUDED."lastSeen"
  `;
}

export async function neonVisitorStats(): Promise<VisitorStats> {
  const db = await getSql();
  const now = Date.now();
  const liveCutoff = new Date(now - 120_000).toISOString();
  const h12Cutoff = new Date(now - 12 * 3600 * 1000).toISOString();
  const [live, last12h, total, launched] = await Promise.all([
    db`SELECT COUNT(*) AS n FROM visitors WHERE "lastSeen" >= ${liveCutoff}`,
    db`SELECT COUNT(*) AS n FROM visitors WHERE "lastSeen" >= ${h12Cutoff}`,
    db`SELECT COUNT(*) AS n FROM visitors`,
    db`SELECT value FROM meta WHERE "key" = ${"launchedAt"}`,
  ]);
  return {
    live: num(live[0]?.n),
    last12h: num(last12h[0]?.n),
    sinceLaunch: num(total[0]?.n),
    launchedAt: str(launched[0]?.value, new Date().toISOString()),
  };
}

export async function neonRevenueStats(): Promise<{
  revenueUnits: number;
  revenueSol: number;
}> {
  const db = await getSql();
  const r = await db`SELECT COALESCE(SUM("paidUnits"), 0) AS n FROM listings`;
  const revenueUnits = num(r[0]?.n);
  return { revenueUnits, revenueSol: revenueUnits / 100 };
}

export async function neonGetMeta(key: string): Promise<string | null> {
  const db = await getSql();
  const r = await db`SELECT value FROM meta WHERE "key" = ${key}`;
  if (!r.length || r[0].value == null) return null;
  return str(r[0].value);
}

export async function neonSetMeta(key: string, value: string): Promise<void> {
  const db = await getSql();
  await db`
    INSERT INTO meta ("key", value) VALUES (${key}, ${value})
    ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value
  `;
}
