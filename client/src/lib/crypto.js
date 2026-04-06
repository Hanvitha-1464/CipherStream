import { concatBytes } from "./bytes.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ECDH_PARAMS = { name: "ECDH", namedCurve: "P-256" };

export async function createKeyPair() {
  return crypto.subtle.generateKey(ECDH_PARAMS, true, ["deriveKey"]);
}

export async function exportPublicKey(publicKey) {
  return crypto.subtle.exportKey("jwk", publicKey);
}

export async function importPublicKey(publicKey) {
  return crypto.subtle.importKey("jwk", publicKey, ECDH_PARAMS, true, []);
}

export async function deriveSessionKey(privateKey, remotePublicKey) {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: remotePublicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function maybeEncryptBytes(bytes, sessionKey) {
  if (!sessionKey) throw new Error("Secure session key not ready.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sessionKey, bytes);
  return { encrypted: true, data: concatBytes([iv, new Uint8Array(cipherBuffer)]) };
}

export async function maybeDecryptBytes(bytes, sessionKey, encrypted) {
  if (!encrypted) return bytes;
  if (!sessionKey) throw new Error("Secure session key not ready.");
  const iv = bytes.slice(0, 12);
  const payload = bytes.slice(12);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sessionKey, payload);
  return new Uint8Array(plainBuffer);
}

export function decodeJson(bytes) { return JSON.parse(decoder.decode(bytes)); }
export function encodeJson(value) { return encoder.encode(JSON.stringify(value)); }
export function encodeString(value) { return encoder.encode(value); }
export function decodeString(bytes) { return decoder.decode(bytes); }
export function encodeBlobUrl(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
