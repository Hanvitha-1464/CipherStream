import { concatBytes } from "./bytes.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function deriveKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function maybeEncryptBytes(bytes, passphrase) {
  if (!passphrase) return { encrypted: false, data: bytes };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { encrypted: true, data: concatBytes([salt, iv, new Uint8Array(cipherBuffer)]) };
}

export async function maybeDecryptBytes(bytes, passphrase, encrypted) {
  if (!encrypted) return bytes;
  if (!passphrase) throw new Error("Passphrase required to decrypt incoming payload.");
  const salt = bytes.slice(0, 16);
  const iv = bytes.slice(16, 28);
  const payload = bytes.slice(28);
  const key = await deriveKey(passphrase, salt);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
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
