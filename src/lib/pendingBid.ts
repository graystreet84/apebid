export const PENDING_BID_KEY = "apebid-pending-bid";

export type PendingBid = {
  signature: string;
  identity: string;
  amountSol: number;
};

export type PendingStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function browserSessionStorage(): PendingStorage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function asPendingBid(raw: unknown): PendingBid | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const signature = typeof rec.signature === "string" ? rec.signature.trim() : "";
  const identity = typeof rec.identity === "string" ? rec.identity.trim() : "";
  const amountSol =
    typeof rec.amountSol === "number"
      ? rec.amountSol
      : typeof rec.amountSol === "string"
        ? Number(rec.amountSol)
        : NaN;
  if (!signature || !identity || !Number.isFinite(amountSol) || amountSol <= 0) {
    return null;
  }
  return { signature, identity, amountSol };
}

export function readPendingBid(storage?: PendingStorage | null): PendingBid | null {
  const store = storage === undefined ? browserSessionStorage() : storage;
  if (!store) return null;
  try {
    const raw = store.getItem(PENDING_BID_KEY);
    if (!raw) return null;
    return asPendingBid(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePendingBid(
  record: PendingBid,
  storage?: PendingStorage | null
): void {
  const store = storage === undefined ? browserSessionStorage() : storage;
  if (!store) return;
  const next = asPendingBid(record);
  if (!next) return;
  try {
    store.setItem(PENDING_BID_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearPendingBid(storage?: PendingStorage | null): void {
  const store = storage === undefined ? browserSessionStorage() : storage;
  if (!store) return;
  try {
    store.removeItem(PENDING_BID_KEY);
  } catch {
    /* ignore */
  }
}
