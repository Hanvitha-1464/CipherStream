// src/modules/ReceiverModule.ts
import type { AppState, PacketStatus, TransferStats } from "../types";
import { WebRTCManager } from "./WebRTCManager";
import { DCTSteganography } from "./DCTSteganography";
import { PacketProcessor } from "./PacketProcessor";
import { PacketType } from "../constants/packetTypes";

// Callback types
type StatsUpdateCallback = (stats: TransferStats) => void;
type StatusUpdateCallback = (status: PacketStatus[]) => void;
type StateUpdateCallback = (state: AppState) => void;
type ResultUpdateCallback = (result: string) => void;

export class ReceiverModule {
  // ==== State ====
  private receivedPackets: Map<number, Uint8Array> = new Map();
  private expectedPackets = 0;
  private receivedPacketCount = 0;

  private webrtc: WebRTCManager;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationId: number | null = null;
  private isRunning = false;

  private videoElement: HTMLVideoElement;
  private currentFragmentIndex = -1;
  private currentPacketBuffer: Uint8Array | null = null;
  private assemblingPacket = false;

  // ==== Callbacks (explicit for erasableSyntaxOnly) ====
  private onStatsUpdate: StatsUpdateCallback;
  private onStatusUpdate: StatusUpdateCallback;
  private onStateUpdate: StateUpdateCallback;
  private onResultUpdate: ResultUpdateCallback;
  private onFileInfo: (name: string, size: number) => void;

  constructor(
    onStatsUpdate: StatsUpdateCallback,
    onStatusUpdate: StatusUpdateCallback,
    onStateUpdate: StateUpdateCallback,
    onResultUpdate: ResultUpdateCallback,
    onFileInfo: (name: string, size: number) => void,
  ) {
    this.onStatsUpdate = onStatsUpdate;
    this.onStatusUpdate = onStatusUpdate;
    this.onStateUpdate = onStateUpdate;
    this.onResultUpdate = onResultUpdate;
    this.onFileInfo = onFileInfo;

    this.webrtc = new WebRTCManager("receiver");

    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = 240;

    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to get canvas context");
    }
    this.ctx = context;

    this.videoElement = document.getElementById(
      "remoteVideo",
    ) as HTMLVideoElement;

    this.webrtc.setConnectionStateHandler((state: string) => {
      if (state === "connected") {
        this.onStateUpdate("connected");
        this.startReceiving();
      }
    });

    this.webrtc.setRemoteStreamHandler((stream: MediaStream) => {
      this.videoElement.srcObject = stream;
    });

    this.webrtc.setDataChannelMessageHandler(() => {});

    window.addEventListener("message", this.handleSignalingMessage.bind(this));
  }

  // ==== Signaling ====
  private handleSignalingMessage(event: MessageEvent): void {
    if (event.data?.type === "offer") {
      this.handleOffer(event.data.data);
    }
  }

  private async handleOffer(offerString: string): Promise<void> {
    this.onStateUpdate("signaling");
    await this.webrtc.initialize();

    const answer = await this.webrtc.receiveOffer(offerString);
    window.opener?.postMessage({ type: "answer", data: answer }, "*");
  }

  async start(): Promise<void> {
    const localVideo = document.getElementById(
      "localVideo",
    ) as HTMLVideoElement;

    const localStream = this.webrtc.getLocalStream();
    if (localStream && localVideo) {
      localVideo.srcObject = localStream;
    }

    this.onFileInfo("Receiving...", 0);
  }

  // ==== Receiving / Decoding ====
  private startReceiving(): void {
    this.isRunning = true;
    this.onStateUpdate("receiving");
    this.startDecoding();
  }

  private startDecoding(): void {
    const decodeFrame = () => {
      if (!this.isRunning) return;

      if (this.videoElement.videoWidth > 0) {
        this.canvas.width = this.videoElement.videoWidth;
        this.canvas.height = this.videoElement.videoHeight;

        this.ctx.drawImage(this.videoElement, 0, 0);
        const imageData = this.ctx.getImageData(
          0,
          0,
          this.canvas.width,
          this.canvas.height,
        );

        const result = DCTSteganography.extractData(imageData);
        if (result.data && result.fragmentIndex >= 0) {
          this.processFragment(result.data, result.fragmentIndex);
        }
      }

      this.animationId = requestAnimationFrame(decodeFrame);
    };

    this.animationId = requestAnimationFrame(decodeFrame);
  }

  private processFragment(data: Uint8Array, fragmentIndex: number): void {
    if (fragmentIndex === 0 && this.currentFragmentIndex !== 0) {
      this.currentPacketBuffer = new Uint8Array(data.length * 4);
      this.currentFragmentIndex = 0;
      this.assemblingPacket = true;
    }

    if (
      this.assemblingPacket &&
      fragmentIndex === this.currentFragmentIndex &&
      this.currentPacketBuffer
    ) {
      this.currentPacketBuffer.set(data, fragmentIndex * data.length);
      this.currentFragmentIndex++;

      if (this.currentFragmentIndex >= 4) {
        this.processCompletePacket(this.currentPacketBuffer);
        this.assemblingPacket = false;
        this.currentFragmentIndex = -1;
      }
    }
  }

  // ==== Packet Handling ====
  private processCompletePacket(packetData: Uint8Array): void {
    try {
      const parsed = PacketProcessor.parsePacket(packetData);

      if (!parsed.valid) {
        this.sendNack(parsed.header.sequenceNumber);
        return;
      }

      this.receivedPackets.set(parsed.header.sequenceNumber, parsed.payload);

      this.expectedPackets = parsed.header.totalPackets;
      this.receivedPacketCount = this.receivedPackets.size;

      this.updatePacketStatus();
      this.sendAck(parsed.header.sequenceNumber);

      if (parsed.header.packetType === PacketType.END) {
        this.assembleFile();
      }

      this.updateStats();
    } catch (error) {
      console.error("Failed to process packet:", error);
    }
  }

  private updatePacketStatus(): void {
    const status: PacketStatus[] = [];

    for (let i = 0; i < this.expectedPackets; i++) {
      status.push({
        sequence: i,
        state: this.receivedPackets.has(i) ? "acked" : "pending",
        retries: 0,
      });
    }

    this.onStatusUpdate(status);
  }

  private sendAck(sequence: number): void {
    this.webrtc.sendData(
      JSON.stringify({ type: "ack", sequenceNumber: sequence }),
    );
  }

  private sendNack(sequence: number): void {
    this.webrtc.sendData(
      JSON.stringify({ type: "nack", sequenceNumber: sequence }),
    );
  }

  // ==== File Assembly ====
  private assembleFile(): void {
    this.onStateUpdate("verifying");

    const packets: Uint8Array[] = [];
    for (let i = 0; i < this.expectedPackets; i++) {
      const packet = this.receivedPackets.get(i);
      if (!packet) {
        this.onResultUpdate("ERROR: Missing packets");
        return;
      }
      packets.push(packet);
    }

    const metadataView = new DataView(packets[0].buffer);
    const expectedCrc = metadataView.getUint32(0, true);

    const fileData = new Uint8Array(1024);
    let offset = 0;

    for (let i = 1; i < packets.length - 1; i++) {
      fileData.set(packets[i], offset);
      offset += packets[i].length;
    }

    const actualCrc = PacketProcessor.calculateCRC32(fileData);

    if (actualCrc === expectedCrc) {
      this.onResultUpdate("SUCCESS: File integrity verified");
      this.onFileInfo("received_file.txt", 1024);
      this.downloadFile(fileData);
    } else {
      this.onResultUpdate(
        `ERROR: CRC mismatch. Expected ${expectedCrc}, got ${actualCrc}`,
      );
    }

    this.onStateUpdate("complete");
  }

  private downloadFile(data: Uint8Array): void {
    // Force a real ArrayBuffer (not SharedArrayBuffer)
    const safeBuffer = data.slice().buffer as ArrayBuffer;

    const blob = new Blob([safeBuffer], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "received_file.txt";
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==== Stats / Lifecycle ====
  private updateStats(): void {
    const packets = this.receivedPacketCount;
    const bytes = packets * 128;
    const frames = this.animationId ? performance.now() / 16.67 : 0;

    this.onStatsUpdate({
      packetsSent: packets,
      packetsAcked: packets,
      bytesTransferred: bytes,
      framesProcessed: Math.floor(frames),
      transferRate: 0,
      estimatedTimeRemaining: 0,
    });
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.onStateUpdate("idle");
  }

  cleanup(): void {
    this.stop();
    this.webrtc.cleanup();
  }
}
