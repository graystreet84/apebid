import type { Connection } from "@solana/web3.js";
import { formatSimulateError } from "./bidPreflight";

export type SignatureStatusLike = {
  err?: unknown;
  confirmationStatus?: string | null;
} | null;

export type ConfirmOutcome =
  | { kind: "landed" }
  | { kind: "failed"; error: string }
  | { kind: "expired" }
  | { kind: "timeout" };

export function isBlockHeightExceededError(err: unknown): boolean {
  if (err == null) return false;
  const name =
    typeof err === "object" && err && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof err === "object" && err && "message" in err
          ? String((err as { message: unknown }).message)
          : "";
  return (
    name === "TransactionExpiredBlockheightExceededError" ||
    /block height exceeded/i.test(msg) ||
    /TransactionExpiredBlockheightExceeded/i.test(`${name} ${msg}`)
  );
}

export function signatureLandedOk(status: SignatureStatusLike): boolean {
  if (!status || status.err) return false;
  return (
    status.confirmationStatus === "confirmed" ||
    status.confirmationStatus === "finalized"
  );
}

export function shouldPostBid(outcome: ConfirmOutcome): boolean {
  return outcome.kind !== "failed";
}

export async function waitForSignatureLanded(
  fetchStatus: (signature: string) => Promise<SignatureStatusLike>,
  signature: string,
  opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<ConfirmOutcome> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const intervalMs = opts?.intervalMs ?? 1_500;
  const now = opts?.now ?? Date.now;
  const sleep =
    opts?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const start = now();

  while (now() - start < timeoutMs) {
    try {
      const status = await fetchStatus(signature);
      if (status?.err) {
        return { kind: "failed", error: formatSimulateError(status.err) };
      }
      if (signatureLandedOk(status)) return { kind: "landed" };
    } catch (err) {
      if (isBlockHeightExceededError(err)) return { kind: "expired" };
    }
    await sleep(intervalMs);
  }
  return { kind: "timeout" };
}

export async function fetchSignatureStatus(
  connection: Pick<Connection, "getSignatureStatuses">,
  signature: string
): Promise<SignatureStatusLike> {
  const res = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  return res.value[0] ?? null;
}
