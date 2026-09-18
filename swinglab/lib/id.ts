/**
 * Client-generated session id. Nothing about a swing ever reaches a server, so
 * this is the only handle that exists — it keys the IndexedDB record and every
 * artefact later phases hang off it.
 */
export function newSessionId(): string {
  const stamp = Date.now().toString(36);
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `sw_${stamp}_${rand}`;
}
