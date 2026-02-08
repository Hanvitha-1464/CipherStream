// src/types.ts (alternative version with import)
import type { PacketTypeValue } from "./constants/packetTypes";

export type TransferRole = "sender" | "receiver";
export type AppState =
  | "idle"
  | "signaling"
  | "connected"
  | "sending"
  | "receiving"
  | "verifying"
  | "complete"
  | "error";

export type PacketState = "pending" | "sent" | "acked" | "retrying" | "failed";

export interface PacketStatus {
  sequence: number;
  state: PacketState;
  retries: number;
}

export interface TransferStats {
  packetsSent: number;
  packetsAcked: number;
  bytesTransferred: number;
  framesProcessed: number;
  transferRate: number;
  estimatedTimeRemaining: number;
}

export interface PacketHeader {
  packetType: PacketTypeValue;
  sequenceNumber: number;
  totalPackets: number;
  payloadLength: number;
  fileId: number;
}

export interface FileInfo {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  bundlePolicy?: RTCBundlePolicy;
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
}

export interface DCTConfig {
  blockSize: number;
  coeffRange: [number, number];
  minCoeffValue: number;
  syncMarker: number;
  frameWidth: number;
  frameHeight: number;
  frameRate: number;
}

export interface PacketConfig {
  headerSize: number;
  maxPayloadSize: number;
  totalPackets: number;
  fragmentsPerPacket: number;
  ackTimeout: number;
  maxRetries: number;
}

export interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate" | "error";
  data: any;
  timestamp: number;
}
