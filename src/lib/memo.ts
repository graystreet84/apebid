export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const LEGACY_MEMO_PROGRAM_ID =
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";

export const BID_MEMO_PREFIX = "apebid:";
export const BID_MAX_AGE_SECONDS = 15 * 60;

export function bidMemoData(mint: string): string {
  return `${BID_MEMO_PREFIX}${mint}`;
}

export function memoMatchesMint(memo: string, mint: string): boolean {
  const trimmed = memo.trim();
  return trimmed === mint || trimmed === bidMemoData(mint);
}

export function isMemoProgramId(id: string): boolean {
  return id === MEMO_PROGRAM_ID || id === LEGACY_MEMO_PROGRAM_ID;
}
