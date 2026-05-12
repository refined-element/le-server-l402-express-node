/**
 * Parses an `Authorization: L402 <macaroon>:<preimage>` header.
 *
 * Per the L402 spec, the credential format is:
 *   - Scheme: `L402` (case-insensitive on parse, per HTTP spec)
 *   - Credential: `<base64-macaroon>:<hex-preimage>`
 *
 * Returns `null` for any malformed input — the caller should treat that as
 * "no credential present" and issue a fresh 402 challenge.
 */
export function parseAuthHeader(
  authHeader: string | undefined | null,
): { macaroon: string; preimage: string } | null {
  if (!authHeader || typeof authHeader !== "string") return null;

  const trimmed = authHeader.trim();
  // Match scheme case-insensitively, exactly one space separator, then
  // the credential. Anything else → null.
  const match = trimmed.match(/^L402\s+(.+)$/i);
  if (!match) return null;

  const credential = match[1].trim();
  const colonIdx = credential.indexOf(":");
  if (colonIdx <= 0 || colonIdx === credential.length - 1) return null;

  const macaroon = credential.slice(0, colonIdx);
  const preimage = credential.slice(colonIdx + 1);

  if (macaroon.length === 0 || preimage.length === 0) return null;

  return { macaroon, preimage };
}
