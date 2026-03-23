import { crc32 } from "./crc32.js";
import { concatBytes } from "./bytes.js";

const HEADER_MAGIC = [0x43, 0x53];
const FRAME_MAGIC = [0x51, 0x53, 0x54, 0x4d];
const PACKET_PAYLOAD = 128;
const FRAME_FOOTER_BYTES = 6;

export function packetizeTransfer(transferId, type, payloadBytes, metadataBytes, encrypted) {
  const packets = [];
  const totalPackets = Math.max(1, Math.ceil(payloadBytes.length / PACKET_PAYLOAD));

  for (let packetIndex = 0; packetIndex < totalPackets; packetIndex += 1) {
    const start = packetIndex * PACKET_PAYLOAD;
    const end = Math.min(start + PACKET_PAYLOAD, payloadBytes.length);
    const chunk = payloadBytes.slice(start, end);
    const includeMetadata = packetIndex === 0 ? metadataBytes : new Uint8Array(0);
    const header = Uint8Array.from([
      ...HEADER_MAGIC,
      (transferId >>> 8) & 0xff,
      transferId & 0xff,
      type,
      encrypted ? 1 : 0,
      (totalPackets >>> 8) & 0xff,
      totalPackets & 0xff,
      (packetIndex >>> 8) & 0xff,
      packetIndex & 0xff,
      (chunk.length >>> 8) & 0xff,
      chunk.length & 0xff,
      (includeMetadata.length >>> 8) & 0xff,
      includeMetadata.length & 0xff,
    ]);
    const body = concatBytes([header, includeMetadata, chunk]);
    const checksum = crc32(body);
    packets.push(concatBytes([
      body,
      Uint8Array.from([
        (checksum >>> 24) & 0xff,
        (checksum >>> 16) & 0xff,
        (checksum >>> 8) & 0xff,
        checksum & 0xff,
      ]),
    ]));
  }

  return packets;
}

export function unpackPacket(packetBytes) {
  if (packetBytes.length < 18) return null;
  if (packetBytes[0] !== HEADER_MAGIC[0] || packetBytes[1] !== HEADER_MAGIC[1]) return null;

  const transferId = (packetBytes[2] << 8) | packetBytes[3];
  const type = packetBytes[4];
  const encrypted = packetBytes[5] === 1;
  const totalPackets = (packetBytes[6] << 8) | packetBytes[7];
  const packetIndex = (packetBytes[8] << 8) | packetBytes[9];
  const payloadLength = (packetBytes[10] << 8) | packetBytes[11];
  const metadataLength = (packetBytes[12] << 8) | packetBytes[13];
  const metadataEnd = 14 + metadataLength;
  const payloadEnd = metadataEnd + payloadLength;
  const checksumStart = payloadEnd;
  if (packetBytes.length < checksumStart + 4) return null;

  const body = packetBytes.slice(0, checksumStart);
  const expectedChecksum =
    (packetBytes[checksumStart] << 24) |
    (packetBytes[checksumStart + 1] << 16) |
    (packetBytes[checksumStart + 2] << 8) |
    packetBytes[checksumStart + 3];

  if ((crc32(body) >>> 0) !== (expectedChecksum >>> 0)) return null;

  return {
    transferId,
    type,
    encrypted,
    totalPackets,
    packetIndex,
    metadata: packetBytes.slice(14, metadataEnd),
    payload: packetBytes.slice(metadataEnd, payloadEnd),
  };
}

export function appendPacketToEncodedFrame(frame, packetBytes) {
  if (!packetBytes || packetBytes.length === 0) return false;
  if (!frame.data) return false;

  const source = new Uint8Array(frame.data);
  const combined = new Uint8Array(source.length + packetBytes.length + FRAME_FOOTER_BYTES);
  combined.set(source, 0);
  combined.set(packetBytes, source.length);
  combined.set(FRAME_MAGIC, source.length + packetBytes.length);
  combined[source.length + packetBytes.length + 4] = (packetBytes.length >>> 8) & 0xff;
  combined[source.length + packetBytes.length + 5] = packetBytes.length & 0xff;
  frame.data = combined.buffer;
  return true;
}

export function extractPacketFromEncodedFrame(frame) {
  if (!frame.data) return null;
  const bytes = new Uint8Array(frame.data);
  if (bytes.length < FRAME_FOOTER_BYTES) return null;

  const footerIndex = bytes.length - FRAME_FOOTER_BYTES;
  for (let i = 0; i < FRAME_MAGIC.length; i += 1) {
    if (bytes[footerIndex + i] !== FRAME_MAGIC[i]) {
      return null;
    }
  }

  const packetLength = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  const packetStart = footerIndex - packetLength;
  if (packetStart < 0) return null;

  const packet = bytes.slice(packetStart, footerIndex);
  const clean = bytes.slice(0, packetStart);
  frame.data = clean.buffer;
  return packet;
}
