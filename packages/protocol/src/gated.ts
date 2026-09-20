// Sealed story bodies for single-reader paid gating (slice 1).
//
// Demo-grade end-to-end confidentiality, NOT audited cryptography:
// - Random 256-bit data key per story; body sealed with AES-256-GCM.
// - Data key wrapped for exactly one reader via X25519 ECDH (NaCl-box style
//   construction from Node primitives: ephemeral keypair, SHA-256 KDF,
//   AES-256-GCM wrap). One wrapped key per story is the slice-1 scope.
// - Kinfolk keys stay separated by purpose: Ed25519 signs (identity, see
//   index.ts), X25519 decrypts (confidentiality). Never mix the two.
// - The envelope lives INSIDE story.json, so the manifest hash plus Ed25519
//   signature bind it: stripping, swapping, or downgrading it invalidates
//   the package for verifying readers.
// - Gated stories publish the SAME bytes to every backend, so cross-backend
//   parity still holds. Per-reader package variants (and per-audience
//   parity) are an explicitly later slice.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const GATED_ALGORITHM = "aes-256-gcm";
const KDF_LABEL = "ownplace-gated-v1";
const BODY_NONCE_BYTES = 12;
const KEY_NONCE_BYTES = 12;
const DATA_KEY_BYTES = 32;
const GCM_TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 8192;
const MAX_B64_CHARS = 65536;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export interface WrappedReaderKey {
  readerId: string;
  ephemeralPublicKey: string;
  keyNonce: string;
  wrappedKey: string;
}

export interface SealedBody {
  algorithm: typeof GATED_ALGORITHM;
  bodyNonce: string;
  ciphertext: string;
  wrapped: WrappedReaderKey;
}

export type OpenResult =
  | { status: "public"; body: string }
  | { status: "opened"; body: string }
  | { status: "restricted" }
  | { status: "not-entitled" }
  | { status: "unreadable" };

export function isSafeReaderId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) &&
    !id.includes("..")
  );
}

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromB64(value: unknown, expectedBytes?: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_B64_CHARS ||
    !B64_RE.test(value)
  ) {
    throw new Error("gated envelope is malformed");
  }
  const buf = Buffer.from(value, "base64");
  if (expectedBytes !== undefined && buf.length !== expectedBytes) {
    throw new Error("gated envelope is malformed");
  }
  return buf;
}

function loadX25519Public(pem: string, what: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new Error(`${what} is not a readable public key`);
  }
  if (key.asymmetricKeyType !== "x25519") throw new Error(`${what} must be X25519`);
  return key;
}

function loadX25519Private(pem: string, what: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new Error(`${what} is not a readable private key`);
  }
  if (key.asymmetricKeyType !== "x25519") throw new Error(`${what} must be X25519`);
  return key;
}

function rawPublicBytes(key: KeyObject): Buffer {
  return Buffer.from((key.export({ format: "jwk" }) as { x: string }).x, "base64url");
}

function deriveKek(shared: Buffer, ephemeralRaw: Buffer, readerRaw: Buffer): Buffer {
  return createHash("sha256")
    .update(KDF_LABEL, "utf8")
    .update(shared)
    .update(ephemeralRaw)
    .update(readerRaw)
    .digest();
}

// The X25519 private key stays on the reader machine next to the Ed25519
// identity file. The published encryption public key is self-asserted, same
// trust level as the signing key: pin it before relying on it over time.
export function loadOrCreateEncryptionIdentity(
  id: string,
  directory = process.env.OWNPLACE_IDENTITY_DIR ?? join(homedir(), ".local", "share", "ownplace", "identities"),
): { privateKey: string; publicKey: string } {
  if (!isSafeReaderId(id)) throw new Error("unsafe Kinfolk id");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${id}.enc.pem`);
  let privateKey: string;
  try {
    privateKey = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const pair = generateKeyPairSync("x25519");
    privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    try {
      writeFileSync(path, privateKey, { mode: 0o600, flag: "wx" });
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      privateKey = readFileSync(path, "utf8");
    }
  }
  const key = loadX25519Private(privateKey, "Kinfolk encryption key");
  const publicKey = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  return { privateKey, publicKey };
}

export function sealBody(plaintext: string, readerPublicKeyPem: string, readerId: string): SealedBody {
  if (!isSafeReaderId(readerId)) throw new Error("unsafe reader id");
  const readerPublic = loadX25519Public(readerPublicKeyPem, "reader public key");
  if (typeof plaintext !== "string" || plaintext.length === 0) throw new Error("body must be non-empty");
  const plainBytes = new TextEncoder().encode(plaintext);
  if (plainBytes.length > MAX_PLAINTEXT_BYTES) throw new Error("body too large to seal");
  const dataKey = randomBytes(DATA_KEY_BYTES);
  const bodyNonce = randomBytes(BODY_NONCE_BYTES);
  const bodyCipher = createCipheriv(GATED_ALGORITHM, dataKey, bodyNonce);
  const ciphertext = Buffer.concat([bodyCipher.update(plainBytes), bodyCipher.final(), bodyCipher.getAuthTag()]);
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralPublic = ephemeral.publicKey;
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: readerPublic });
  const kek = deriveKek(shared, rawPublicBytes(ephemeralPublic), rawPublicBytes(readerPublic));
  const keyNonce = randomBytes(KEY_NONCE_BYTES);
  const keyCipher = createCipheriv(GATED_ALGORITHM, kek, keyNonce);
  const wrappedKey = Buffer.concat([keyCipher.update(dataKey), keyCipher.final(), keyCipher.getAuthTag()]);
  dataKey.fill(0);
  return {
    algorithm: GATED_ALGORITHM,
    bodyNonce: toB64(bodyNonce),
    ciphertext: toB64(ciphertext),
    wrapped: {
      readerId,
      ephemeralPublicKey: ephemeralPublic.export({ type: "spki", format: "pem" }).toString(),
      keyNonce: toB64(keyNonce),
      wrappedKey: toB64(wrappedKey),
    },
  };
}

function parseEnvelope(envelope: unknown): SealedBody {
  if (!envelope || typeof envelope !== "object") throw new Error("gated envelope is malformed");
  const env = envelope as Record<string, unknown>;
  const wrapped = env.wrapped as Record<string, unknown> | undefined;
  if (
    env.algorithm !== GATED_ALGORITHM ||
    !wrapped ||
    typeof wrapped !== "object" ||
    !isSafeReaderId(wrapped.readerId)
  ) {
    throw new Error("gated envelope is malformed");
  }
  if (typeof wrapped.ephemeralPublicKey !== "string" || wrapped.ephemeralPublicKey.length === 0 || wrapped.ephemeralPublicKey.length > MAX_B64_CHARS) {
    throw new Error("gated envelope is malformed");
  }
  for (const value of [wrapped.keyNonce, wrapped.wrappedKey]) {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_B64_CHARS || !B64_RE.test(value)) {
      throw new Error("gated envelope is malformed");
    }
  }
  fromB64(wrapped.keyNonce, KEY_NONCE_BYTES);
  fromB64(env.bodyNonce, BODY_NONCE_BYTES);
  const ct = fromB64(env.ciphertext);
  if (ct.length < GCM_TAG_BYTES + 1) throw new Error("gated envelope is malformed");
  const wk = fromB64(wrapped.wrappedKey);
  if (wk.length !== DATA_KEY_BYTES + GCM_TAG_BYTES) throw new Error("gated envelope is malformed");
  loadX25519Public(wrapped.ephemeralPublicKey, "ephemeral key");
  return envelope as SealedBody;
}

export function isSealedBody(value: unknown): value is SealedBody {
  try {
    parseEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

// Shape errors throw "gated envelope is malformed" (author or packaging bug
// inside a signed package). Key failures throw "not entitled to this story".
// Callers must present fixed UI strings for both, never crypto internals.
export function unsealBody(envelope: unknown, readerPrivateKeyPem: string, readerId?: string): string {
  const env = parseEnvelope(envelope);
  if (readerId !== undefined && env.wrapped.readerId !== readerId) {
    throw new Error("not entitled to this story");
  }
  const readerPrivate = loadX25519Private(readerPrivateKeyPem, "reader encryption key");
  try {
    const ephemeralPublic = loadX25519Public(env.wrapped.ephemeralPublicKey, "ephemeral key");
    const shared = diffieHellman({ privateKey: readerPrivate, publicKey: ephemeralPublic });
    const kek = deriveKek(shared, rawPublicBytes(ephemeralPublic), rawPublicBytes(createPublicKey(readerPrivate)));
    const wrappedKey = fromB64(env.wrapped.wrappedKey);
    const keyDecipher = createDecipheriv(GATED_ALGORITHM, kek, fromB64(env.wrapped.keyNonce, KEY_NONCE_BYTES));
    keyDecipher.setAuthTag(wrappedKey.subarray(DATA_KEY_BYTES));
    const dataKey = Buffer.concat([
      keyDecipher.update(wrappedKey.subarray(0, DATA_KEY_BYTES)),
      keyDecipher.final(),
    ]);
    const bodyDecipher = createDecipheriv(GATED_ALGORITHM, dataKey, fromB64(env.bodyNonce, BODY_NONCE_BYTES));
    const ct = fromB64(env.ciphertext);
    bodyDecipher.setAuthTag(ct.subarray(ct.length - GCM_TAG_BYTES));
    const plain = Buffer.concat([
      bodyDecipher.update(ct.subarray(0, ct.length - GCM_TAG_BYTES)),
      bodyDecipher.final(),
    ]);
    dataKey.fill(0);
    return new TextDecoder().decode(plain);
  } catch (e) {
    if (e instanceof Error && e.message === "gated envelope is malformed") throw e;
    throw new Error("not entitled to this story");
  }
}

// Display helper: fixed statuses, never crypto internals. A gated story
// carrying a non-empty plaintext body fails closed ("unreadable") — the
// verify path rejects such packages outright (see timeline).
export function tryOpenBody(
  story: { body?: unknown; restricted?: unknown },
  readerPrivateKey?: string,
  readerId?: string,
): OpenResult {
  if (story.restricted === undefined) {
    return typeof story.body === "string" ? { status: "public", body: story.body } : { status: "unreadable" };
  }
  if (story.body !== "" || !isSealedBody(story.restricted)) return { status: "unreadable" };
  if (readerPrivateKey === undefined) return { status: "restricted" };
  try {
    return { status: "opened", body: unsealBody(story.restricted, readerPrivateKey, readerId) };
  } catch (e) {
    return e instanceof Error && e.message === "gated envelope is malformed"
      ? { status: "unreadable" }
      : { status: "not-entitled" };
  }
}
