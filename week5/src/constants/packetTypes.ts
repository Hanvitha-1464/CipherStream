// src/constants/packetTypes.ts
// Don't import PacketType, define it here or use a different approach

export const PacketType = {
  METADATA: 0x01,
  DATA: 0x02,
  END: 0x03,
  ACK: 0x04,
  NACK: 0x05,
} as const;

export type PacketTypeValue = (typeof PacketType)[keyof typeof PacketType];

export const PACKET_TYPE_LABELS: Record<PacketTypeValue, string> = {
  [PacketType.METADATA]: "Metadata",
  [PacketType.DATA]: "Data",
  [PacketType.END]: "End",
  [PacketType.ACK]: "Acknowledgment",
  [PacketType.NACK]: "Negative Acknowledgment",
};

export const PACKET_CONFIG = {
  HEADER_SIZE: 12,
  MAX_PAYLOAD_SIZE: 128,
  TOTAL_PACKETS: 10,
  FRAGMENTS_PER_PACKET: 4,
  ACK_TIMEOUT: 500,
  MAX_RETRIES: 5,
} as const;

export const FILE_CONFIG = {
  MAX_FILE_SIZE: 1024,
  REQUIRED_FILE_SIZE: 1024,
  ALLOWED_MIME_TYPES: [
    "text/plain",
    "text/html",
    "text/css",
    "text/javascript",
    "application/json",
  ],
} as const;

// Alternative: If you need an enum-like type, create a type alias
export type PacketTypeEnum =
  | 0x01 // METADATA
  | 0x02 // DATA
  | 0x03 // END
  | 0x04 // ACK
  | 0x05; // NACK
