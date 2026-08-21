export const BID_RECORD_RETRY_WINDOW_MS = 90_000;

export function isRetryableRecordError(error: string): boolean {
  return /not found|not confirmed yet/i.test(error);
}

export function bidRecordBackoffMs(attempt: number): number {
  return Math.min(1_500 * Math.max(1, attempt), 5_000);
}

export async function recordBidWithRetry<T>(opts: {
  post: () => Promise<T>;
  isRetryable?: (error: string) => boolean;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: string, waitMs: number) => void;
}): Promise<T> {
  const isRetryable = opts.isRetryable ?? isRetryableRecordError;
  const windowMs = opts.windowMs ?? BID_RECORD_RETRY_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const sleep =
    opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + windowMs;
  let attempt = 0;

  while (true) {
    try {
      return await opts.post();
    } catch (err) {
      const message = err instanceof Error ? err.message : "bid failed";
      const lastError = err instanceof Error ? err : new Error(message);
      if (!isRetryable(message)) throw lastError;
      const remaining = deadline - now();
      if (remaining <= 0) throw lastError;
      attempt += 1;
      const wait = Math.min(bidRecordBackoffMs(attempt), remaining);
      opts.onRetry?.(message, wait);
      await sleep(wait);
    }
  }
}
