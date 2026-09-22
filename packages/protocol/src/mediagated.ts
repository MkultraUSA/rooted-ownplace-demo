// Sealed media pointers (M8 #64): pointers live INSIDE the envelope.
//
// Decision #58: plaintext index carries Goal-allowed metadata only — no
// media URLs, counts, or sizes in the clear. Media pointers travel sealed
// with the body, for the SAME reader set (no per-audience media
// partitioning). Wire format unchanged: the restricted plaintext is a
// versioned JSON envelope `{v:1, body, media}`; legacy string bodies
// still open (marked legacy) so old packages keep verifying.
//
// Demo-grade end-to-end confidentiality like gated.ts (NOT audited
// cryptography). Ciphertext size still hints at media size — padding
// deferred per #58, not solved here.

import type { SealReader, SealedBody } from "./gated.js";
import { sealBodyForReaders, unsealBody } from "./gated.js";

export const GATED_CONTENT_VERSION = 1;
export const MAX_MEDIA_ITEMS = 8;
export const MAX_MEDIA_URL_CHARS = 2048;

export interface GatedContent {
  v: typeof GATED_CONTENT_VERSION;
  body: string;
  media: string[];
}

export interface OpenedGatedContent {
  body: string;
  media: string[];
  legacy: boolean;
}

export function isMediaList(value: unknown): value is string[] {
  // Media lives in poster Drive/Nextcloud folders fetched over TLS (#58),
  // so only https pointers seal. Anything else is rejected, never stored.
  return (
    Array.isArray(value) &&
    value.length <= MAX_MEDIA_ITEMS &&
    value.every(
      (u): u is string =>
        typeof u === "string" &&
        u.length >= 9 &&
        u.length <= MAX_MEDIA_URL_CHARS &&
        u.startsWith("https://"),
    )
  );
}

function isGatedContent(value: unknown): value is GatedContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.v === GATED_CONTENT_VERSION &&
    typeof rec.body === "string" &&
    rec.body.length >= 1 &&
    isMediaList(rec.media)
  );
}

export function sealGatedContent(body: string, media: string[], readers: SealReader[]): SealedBody {
  if (typeof body !== "string" || body.length === 0) throw new Error("body must be non-empty");
  if (!isMediaList(media)) throw new Error("media must be a list of at most 8 short URLs");
  // Fixed key order keeps the sealed plaintext deterministic.
  const payload = `{"v":1,"body":${JSON.stringify(body)},"media":${JSON.stringify(media)}}`;
  return sealBodyForReaders(payload, readers);
}

export function openGatedContent(
  envelope: unknown,
  readerPrivateKeyPem: string,
  readerId?: string,
): OpenedGatedContent {
  const plaintext = unsealBody(envelope, readerPrivateKeyPem, readerId);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    // Not JSON: legacy string body sealed before media pointers existed.
  }
  if (isGatedContent(parsed)) return { body: parsed.body, media: parsed.media, legacy: false };
  return { body: plaintext, media: [], legacy: true };
}
