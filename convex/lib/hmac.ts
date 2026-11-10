/**
 * HMAC-SHA256 signing shared by both directions:
 *   Convex -> n8n  (request notifications)
 *   n8n -> Convex  (overdue list + status write-backs)
 *
 * Signed string: `${timestamp}.${METHOD}.${path}.${rawBody}`
 * Headers:       X-LendLoop-Timestamp (unix seconds), X-LendLoop-Signature (hex)
 *
 * Binding the method and path stops a valid signature for one endpoint being
 * replayed against another; the timestamp window limits replay in time.
 */

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

export function canonicalString(timestamp: string, method: string, path: string, body: string) {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison so the check doesn't leak how many characters matched. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
) {
  const timestamp = String(nowSeconds);
  const signature = await hmacHex(secret, canonicalString(timestamp, method, path, body));
  return { timestamp, signature };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifyRequest(
  secret: string | undefined,
  method: string,
  path: string,
  body: string,
  timestamp: string | null,
  signature: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  // Fail closed if the deployment was never given a secret.
  if (!secret) return { ok: false, reason: "server not configured" };
  if (!timestamp || !signature) return { ok: false, reason: "missing signature" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale timestamp" };
  }
  const expected = await hmacHex(secret, canonicalString(timestamp, method, path, body));
  return timingSafeEqual(expected, signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "bad signature" };
}
