// src/modules/SenderModule.ts
import type { AppState, PacketStatus, TransferStats } from "../types";
import { WebRTCManager } from "./WebRTCManager";
import { PacketProcessor } from "./PacketProcessor";

type StatsUpdateCallback = (stats: TransferStats) => void;
type StatusUpdateCallback = (status: PacketStatus[]) => void;
type StateUpdateCallback = (state: AppState) => void;
type ResultUpdateCallback = (result: string) => void;

export class SenderModule {
  private onStatsUpdate: StatsUpdateCallback;
  private onStatusUpdate: StatusUpdateCallback;
  private onStateUpdate: StateUpdateCallback;
  private onResultUpdate: ResultUpdateCallback;
  private onFileClear: () => void;
  private onFileSet: (name: string, size: number) => void;

  private signalingChannel: BroadcastChannel;

  private file: File | null = null;
  private fileData: Uint8Array | null = null;
  private fileId = 0;
  private packets: Uint8Array[] = [];
  private packetStatus: PacketStatus[] = [];
  private currentPacketIndex = 0;

  private isFileReady = false;
  private fileLoadPromise: Promise<void> | null = null;

  private webrtc: WebRTCManager;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationId: number | null = null;

  private waitingForAck = false;
  private ackTimeout: number | null = null;
  private transferStartTime: number = 0;

  constructor(
    onStatsUpdate: StatsUpdateCallback,
    onStatusUpdate: StatusUpdateCallback,
    onStateUpdate: StateUpdateCallback,
    onResultUpdate: ResultUpdateCallback,
    onFileClear: () => void,
    onFileSet: (name: string, size: number) => void,
  ) {
    this.onStatsUpdate = onStatsUpdate;
    this.onStatusUpdate = onStatusUpdate;
    this.onStateUpdate = onStateUpdate;
    this.onResultUpdate = onResultUpdate;
    this.onFileClear = onFileClear;
    this.onFileSet = onFileSet;

    this.signalingChannel = new BroadcastChannel("cipherstream_signaling");
    this.signalingChannel.onmessage = this.handleSignalingMessage.bind(this);

    this.webrtc = new WebRTCManager("sender");

    // Create status canvas for video stream
    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = 240;

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    this.ctx = ctx;

    this.webrtc.setIceCandidateHandler((candidate) => {
      this.signalingChannel.postMessage({
        type: "candidate",
        data: candidate.toJSON(),
      });
    });

    this.webrtc.setConnectionStateHandler((state) => {
      if (state === "connected") {
        this.onStateUpdate("connected");
      }
    });

    this.webrtc.setDataChannelOpenHandler(() => {
      console.log("✅ Data channel ready, starting transfer");
      this.startSending();
    });

    this.webrtc.setRemoteStreamHandler((stream: MediaStream) => {
      console.log("📺 Sender: Remote stream received from receiver");
      const remoteVideoElement = document.getElementById(
        "remoteVideo",
      ) as HTMLVideoElement;
      if (remoteVideoElement) {
        remoteVideoElement.srcObject = stream;
        // Force play
        remoteVideoElement
          .play()
          .then(() => {
            console.log("✅ Sender: Remote video playing");
          })
          .catch((err) => {
            console.warn("⚠️ Sender: Remote video play failed:", err);
          });
      } else {
        console.error("❌ Sender: Remote video element not found!");
      }
    });

    this.webrtc.setDataChannelMessageHandler(
      this.handleDataChannelMessage.bind(this),
    );
  }

  setFile(file: File): void {
    this.file = file;
    this.onFileSet(file.name, file.size);
    this.isFileReady = false;
    this.fileData = null;
    this.fileLoadPromise = this.readFile();
  }

  private readFile(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.file) {
        reject(new Error("No file"));
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        if (!(reader.result instanceof ArrayBuffer)) {
          reject(new Error("Invalid file data"));
          return;
        }

        this.fileData = new Uint8Array(reader.result);
        this.fileId = Date.now() % 0xffffffff;

        this.packets = PacketProcessor.splitFileIntoPackets(
          this.fileData,
          this.fileId,
        );

        this.packetStatus = this.packets.map((_, i) => ({
          sequence: i,
          state: "pending",
          retries: 0,
        }));

        this.isFileReady = true;
        this.onStatusUpdate(this.packetStatus);
        resolve();
      };

      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this.file);
    });
  }

  async start(): Promise<void> {
    if (!this.file) {
      this.onResultUpdate("ERROR: No file selected");
      return;
    }

    if (this.fileLoadPromise && !this.isFileReady) {
      await this.fileLoadPromise;
    }

    if (!this.fileData || this.fileData.length !== 1024) {
      this.onResultUpdate("ERROR: File must be exactly 1024 bytes");
      return;
    }

    try {
      console.log("📤 Sender: Starting transfer");
      this.onStateUpdate("signaling");

      // Draw status on canvas
      this.updateStatusCanvas("Initializing...");
      const stream = this.canvas.captureStream(1);

      console.log("📹 Sender: Canvas stream created");
      console.log(
        "   Tracks:",
        stream.getTracks().map((t) => `${t.kind}:${t.id}`),
      );

      // Display local stream
      const localVideo = document.getElementById(
        "localVideo",
      ) as HTMLVideoElement;
      if (localVideo) {
        localVideo.srcObject = stream;
        localVideo.muted = true; // Important for local video
        localVideo
          .play()
          .then(() => {
            console.log("✅ Sender: Local video playing");
          })
          .catch((err) => {
            console.warn("⚠️ Sender: Local video play failed:", err);
          });
      } else {
        console.error("❌ Sender: Local video element not found!");
      }

      // Initialize WebRTC
      await this.webrtc.initialize();
      this.webrtc.setLocalStream(stream);

      // Create and send offer
      const offer = await this.webrtc.createOffer();
      this.signalingChannel.postMessage({ type: "offer", data: offer });

      console.log("✅ Sender: Offer sent, waiting for answer");
      this.updateStatusCanvas("Waiting for receiver...");

      // Start canvas animation
      this.startStatusAnimation();
    } catch (error) {
      console.error("❌ Sender: Error during start:", error);
      this.onStateUpdate("error");
      this.onResultUpdate(
        `ERROR: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private handleSignalingMessage(event: MessageEvent): void {
    if (event.data?.type === "answer") {
      console.log("📨 Sender: Received answer from receiver");
      this.webrtc.receiveAnswer(event.data.data);
      this.updateStatusCanvas("Connected!");
    } else if (event.data?.type === "candidate") {
      console.log("🧊 Sender: Received ICE candidate");
      this.webrtc.addIceCandidate(event.data.data);
    }
  }

  private handleDataChannelMessage(data: ArrayBuffer | string): void {
    try {
      const msg = JSON.parse(data as string);

      if (msg.type === "ack") {
        this.handleAck(msg.sequenceNumber);
      } else if (msg.type === "nack") {
        this.handleNack(msg.sequenceNumber);
      }
    } catch (error) {
      console.error("❌ Sender: Error handling message:", error);
    }
  }

  private handleAck(sequence: number): void {
    if (!this.packetStatus[sequence]) {
      console.warn(`⚠️ Sender: Invalid sequence number ${sequence}`);
      return;
    }

    console.log(`✅ Sender: ACK received for packet ${sequence}`);
    clearTimeout(this.ackTimeout!);
    this.packetStatus[sequence].state = "acked";
    this.packetStatus[sequence].retries = 0;
    this.onStatusUpdate(this.packetStatus);

    this.waitingForAck = false;
    this.currentPacketIndex++;

    this.updateStats();

    if (this.currentPacketIndex >= this.packets.length) {
      console.log("🎉 Sender: All packets sent successfully!");
      this.onStateUpdate("complete");
      this.onResultUpdate("SUCCESS: File transfer completed");
      this.updateStatusCanvas("Transfer Complete!");
      this.stop();
    } else {
      this.sendNextPacket();
    }
  }

  private handleNack(sequence: number): void {
    console.log(`⚠️ Sender: NACK received for packet ${sequence}`);
    clearTimeout(this.ackTimeout!);
    this.retryCurrentPacket();
  }

  private startSending(): void {
    this.onStateUpdate("sending");
    this.currentPacketIndex = 0;
    this.transferStartTime = Date.now();
    this.updateStatusCanvas("Sending...");
    this.sendNextPacket();
  }

  private sendNextPacket(): void {
    if (!this.packetStatus[this.currentPacketIndex]) return;

    const packet = this.packets[this.currentPacketIndex];

    console.log(
      `📤 Sender: Sending packet ${this.currentPacketIndex}/${this.packets.length}, size: ${packet.length} bytes`,
    );

    // Log first few bytes for debugging
    const preview = Array.from(packet.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    console.log(`   First 16 bytes: ${preview}`);

    // Log last 8 bytes (includes CRC)
    const lastBytes = Array.from(packet.slice(-8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    console.log(`   Last 8 bytes: ${lastBytes}`);

    // CRITICAL FIX: Send the exact slice of the buffer, not the entire underlying ArrayBuffer
    // The issue is that packet.buffer might be larger than packet.length
    const exactPacket = packet.slice(); // Creates a new Uint8Array with its own ArrayBuffer
    const success = this.webrtc.sendData(exactPacket.buffer);

    if (success) {
      this.waitingForAck = true;
      this.packetStatus[this.currentPacketIndex].state = "sent";
      this.onStatusUpdate(this.packetStatus);

      // Update visual status
      this.updateStatusCanvas(
        `Sending ${this.currentPacketIndex + 1}/${this.packets.length}`,
      );

      // Set timeout for ACK
      this.ackTimeout = window.setTimeout(
        () => this.retryCurrentPacket(),
        1000,
      );
    } else {
      console.error("❌ Failed to send packet, retrying...");
      setTimeout(() => this.sendNextPacket(), 100);
    }
  }

  private retryCurrentPacket(): void {
    const status = this.packetStatus[this.currentPacketIndex];
    if (!status) return;

    if (status.retries >= 5) {
      status.state = "failed";
      this.onStateUpdate("error");
      this.onResultUpdate("ERROR: Max retries exceeded");
      this.updateStatusCanvas("Transfer Failed!");
      this.stop();
      return;
    }

    console.log(
      `⚠️ Sender: Retrying packet ${this.currentPacketIndex} (retry ${status.retries + 1}/5)`,
    );
    status.state = "retrying";
    status.retries++;
    this.onStatusUpdate(this.packetStatus);

    this.waitingForAck = false;
    setTimeout(() => this.sendNextPacket(), 100);
  }

  private updateStats(): void {
    const elapsed = (Date.now() - this.transferStartTime) / 1000;
    const ackedCount = this.packetStatus.filter(
      (p) => p.state === "acked",
    ).length;
    const bytesTransferred = ackedCount * 128; // Approximate
    const transferRate = elapsed > 0 ? bytesTransferred / elapsed : 0;

    this.onStatsUpdate({
      packetsSent: this.currentPacketIndex,
      packetsAcked: ackedCount,
      bytesTransferred,
      framesProcessed: 0,
      transferRate,
      estimatedTimeRemaining: 0,
    });
  }

  private updateStatusCanvas(status: string): void {
    this.ctx.fillStyle = "#1b1f2a";
    this.ctx.fillRect(0, 0, 320, 240);

    this.ctx.fillStyle = "#4f7cff";
    this.ctx.font = "bold 20px Arial";
    this.ctx.textAlign = "center";
    this.ctx.fillText("SENDER", 160, 100);

    this.ctx.font = "16px Arial";
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillText(status, 160, 140);

    if (this.file) {
      this.ctx.font = "12px Arial";
      this.ctx.fillStyle = "#888888";
      this.ctx.fillText(this.file.name, 160, 170);
    }
  }

  private startStatusAnimation(): void {
    let frame = 0;
    const animate = () => {
      if (!this.animationId) return;

      // Add a subtle animation indicator
      const dots = ".".repeat(frame % 4);
      if (this.waitingForAck) {
        this.updateStatusCanvas(
          `Sending ${this.currentPacketIndex + 1}/${this.packets.length}${dots}`,
        );
      }

      frame++;
      this.animationId = requestAnimationFrame(animate);
    };

    this.animationId = requestAnimationFrame(animate);
  }

  stop(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.ackTimeout) clearTimeout(this.ackTimeout);
    this.waitingForAck = false;
  }

  cleanup(): void {
    this.stop();
    this.webrtc.cleanup();
    this.file = null;
    this.fileData = null;
    this.isFileReady = false;
    this.fileLoadPromise = null;
    this.signalingChannel.close();
    this.onFileClear();
  }
}
