// src/modules/ReceiverModule.ts
import type { AppState, PacketStatus, TransferStats } from "../types";
import { WebRTCManager } from "./WebRTCManager";
import { PacketProcessor } from "./PacketProcessor";
import { PacketType } from "../constants/packetTypes";

type StatsUpdateCallback = (stats: TransferStats) => void;
type StatusUpdateCallback = (status: PacketStatus[]) => void;
type StateUpdateCallback = (state: AppState) => void;
type ResultUpdateCallback = (result: string) => void;

export class ReceiverModule {
  private receivedPackets: Map<number, Uint8Array> = new Map();
  private expectedPackets = 0;
  private receivedPacketCount = 0;

  private webrtc: WebRTCManager;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationId: number | null = null;

  private onStatsUpdate: StatsUpdateCallback;
  private onStatusUpdate: StatusUpdateCallback;
  private onStateUpdate: StateUpdateCallback;
  private onResultUpdate: ResultUpdateCallback;
  private onFileInfo: (name: string, size: number) => void;

  private signalingChannel: BroadcastChannel;
  private transferStartTime: number = 0;

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

    this.signalingChannel = new BroadcastChannel("cipherstream_signaling");
    this.signalingChannel.onmessage = this.handleSignalingMessage.bind(this);

    this.webrtc = new WebRTCManager("receiver");

    // Create status canvas for video stream
    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = 240;

    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to get canvas context");
    }
    this.ctx = context;

    this.webrtc.setConnectionStateHandler((state: string) => {
      if (state === "connected") {
        this.onStateUpdate("connected");
      }
    });

    this.webrtc.setDataChannelOpenHandler(() => {
      console.log("✅ Data channel ready, waiting for packets");
      this.onStateUpdate("receiving");
      this.transferStartTime = Date.now();
      this.updateStatusCanvas("Ready to receive...");
    });

    this.webrtc.setRemoteStreamHandler((stream: MediaStream) => {
      console.log("📺 Receiver: Remote stream received");
      console.log(
        "   Stream tracks:",
        stream.getTracks().map((t) => `${t.kind}:${t.id}`),
      );
      const remoteVideoElement = document.getElementById(
        "localVideo",
      ) as HTMLVideoElement;
      if (remoteVideoElement) {
        remoteVideoElement.srcObject = stream;
        remoteVideoElement
          .play()
          .then(() => {
            console.log("✅ Receiver: Remote video playing");
          })
          .catch((err) => {
            console.error("❌ Receiver: Failed to play remote video:", err);
          });
      } else {
        console.error(
          "❌ Receiver: Remote video element 'localVideo' not found!",
        );
      }
    });

    this.webrtc.setDataChannelMessageHandler(
      this.handleDataChannelMessage.bind(this),
    );

    this.webrtc.setIceCandidateHandler((candidate) => {
      this.signalingChannel.postMessage({
        type: "candidate",
        data: candidate.toJSON(),
      });
    });
  }

  private handleSignalingMessage(event: MessageEvent): void {
    if (event.data?.type === "offer") {
      console.log("📨 Receiver: Received offer from sender");
      this.handleOffer(event.data.data);
    } else if (event.data?.type === "candidate") {
      console.log("🧊 Receiver: Received ICE candidate");
      this.webrtc.addIceCandidate(event.data.data);
    }
  }

  private async handleOffer(offerString: string): Promise<void> {
    try {
      console.log("📨 Receiver: Handling offer");
      this.onStateUpdate("signaling");
      this.updateStatusCanvas("Connecting...");

      await this.webrtc.initialize();

      // Create local stream for display
      const stream = this.canvas.captureStream(1);
      this.webrtc.setLocalStream(stream);

      // Display local stream
      const localVideoElement = document.getElementById(
        "remoteVideo",
      ) as HTMLVideoElement;
      if (localVideoElement) {
        localVideoElement.srcObject = stream;
        localVideoElement.muted = true;
        localVideoElement
          .play()
          .then(() => {
            console.log("✅ Receiver: Local video playing");
          })
          .catch((err) => {
            console.warn("⚠️ Receiver: Local video play failed:", err);
          });
      } else {
        console.error(
          "❌ Receiver: Local video element 'remoteVideo' not found!",
        );
      }

      // Start canvas animation
      this.startStatusAnimation();

      const answer = await this.webrtc.receiveOffer(offerString);
      this.signalingChannel.postMessage({ type: "answer", data: answer });

      console.log("✅ Receiver: Answer sent, waiting for connection");
      this.updateStatusCanvas("Waiting for sender...");
    } catch (error) {
      console.error("❌ Receiver: Error handling offer:", error);
      this.onStateUpdate("error");
      this.updateStatusCanvas("Connection Error!");
    }
  }

  async start(): Promise<void> {
    this.onFileInfo("Waiting for file...", 0);
    this.updateStatusCanvas("Waiting for sender...");
  }

  private handleDataChannelMessage(data: ArrayBuffer | string): void {
    if (typeof data === "string") {
      console.log("📨 Received string message:", data);
      return;
    }

    console.log(
      `📨 Receiver: Received ArrayBuffer, byteLength: ${data.byteLength}`,
    );

    // Create Uint8Array from the ArrayBuffer
    const packetData = new Uint8Array(data);
    console.log(`   Uint8Array length: ${packetData.length}`);
    console.log(`   Uint8Array byteOffset: ${packetData.byteOffset}`);
    console.log(
      `   Underlying buffer byteLength: ${packetData.buffer.byteLength}`,
    );

    // Received binary data - this is a packet
    this.processPacket(packetData);
  }

  private processPacket(packetData: Uint8Array): void {
    try {
      console.log(
        `📦 Receiver: Received packet, size: ${packetData.length} bytes`,
      );

      // Log first few bytes for debugging
      const preview = Array.from(packetData.slice(0, 16))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      console.log(`   First 16 bytes: ${preview}`);

      // Log last 8 bytes (includes CRC) - MATCHING SENDER FORMAT
      const lastBytes = Array.from(packetData.slice(-8))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      console.log(`   Last 8 bytes: ${lastBytes}`);

      const parsed = PacketProcessor.parsePacket(packetData);

      if (!parsed.valid) {
        console.warn(
          `❌ Receiver: Invalid packet (CRC mismatch), sending NACK for seq ${parsed.header.sequenceNumber}`,
        );
        console.warn(
          `   Embedded CRC (from packet): ${(parsed.crc >>> 0).toString(16).padStart(8, "0")}`,
        );

        // Calculate CRC ourselves to debug
        const headerAndPayload = packetData.slice(
          0,
          12 + parsed.header.payloadLength,
        );
        const recalcCrc = PacketProcessor.calculateCRC32(headerAndPayload);
        console.warn(
          `   Calculated CRC (header+payload): ${(recalcCrc >>> 0).toString(16).padStart(8, "0")}`,
        );
        console.warn(
          `   Header + payload length: ${headerAndPayload.length} bytes`,
        );
        console.warn(
          `   Payload length from header: ${parsed.header.payloadLength} bytes`,
        );

        this.sendNack(parsed.header.sequenceNumber);
        return;
      }

      console.log(
        `✅ Receiver: Valid packet - seq: ${parsed.header.sequenceNumber}, type: ${parsed.header.packetType}`,
      );
      this.receivedPackets.set(parsed.header.sequenceNumber, parsed.payload);

      this.expectedPackets = parsed.header.totalPackets;
      this.receivedPacketCount = this.receivedPackets.size;

      this.updatePacketStatus();
      this.updateStats();
      this.updateStatusCanvas(
        `Receiving ${this.receivedPacketCount}/${this.expectedPackets}`,
      );

      // Send ACK
      this.sendAck(parsed.header.sequenceNumber);

      // Check if transfer is complete
      if (parsed.header.packetType === PacketType.END) {
        console.log(`🏁 Receiver: END packet received, assembling file...`);
        this.assembleFile();
      }
    } catch (error) {
      console.error("❌ Receiver: Failed to process packet:", error);
      if (error instanceof Error) {
        console.error("   Error message:", error.message);
        console.error("   Error stack:", error.stack);
      }
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
    const ackMessage = JSON.stringify({
      type: "ack",
      sequenceNumber: sequence,
    });
    console.log(`📤 Receiver: Sending ACK for packet ${sequence}`);
    this.webrtc.sendData(ackMessage);
  }

  private sendNack(sequence: number): void {
    const nackMessage = JSON.stringify({
      type: "nack",
      sequenceNumber: sequence,
    });
    console.log(`📤 Receiver: Sending NACK for packet ${sequence}`);
    this.webrtc.sendData(nackMessage);
  }

  private assembleFile(): void {
    this.onStateUpdate("verifying");
    this.updateStatusCanvas("Verifying...");

    const packets: Uint8Array[] = [];
    for (let i = 0; i < this.expectedPackets; i++) {
      const packet = this.receivedPackets.get(i);
      if (!packet) {
        this.onResultUpdate("ERROR: Missing packets");
        this.updateStatusCanvas("Transfer Failed!");
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
      const elapsed = (Date.now() - this.transferStartTime) / 1000;
      this.onResultUpdate(`SUCCESS: File verified in ${elapsed.toFixed(2)}s`);
      this.onFileInfo("received_file.txt", 1024);
      this.updateStatusCanvas("Transfer Complete!");
      this.downloadFile(fileData);
    } else {
      this.onResultUpdate(
        `ERROR: CRC mismatch. Expected ${expectedCrc}, got ${actualCrc}`,
      );
      this.updateStatusCanvas("Verification Failed!");
    }

    this.onStateUpdate("complete");
  }

  private downloadFile(data: Uint8Array): void {
    // Create a proper Blob from the Uint8Array
    const blob = new Blob(
      [data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)],
      {
        type: "text/plain",
      },
    );
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "received_file.txt";
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private updateStats(): void {
    const elapsed = (Date.now() - this.transferStartTime) / 1000;
    const bytes = this.receivedPacketCount * 128;
    const transferRate = elapsed > 0 ? bytes / elapsed : 0;

    this.onStatsUpdate({
      packetsSent: this.receivedPacketCount,
      packetsAcked: this.receivedPacketCount,
      bytesTransferred: bytes,
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
    this.ctx.fillText("RECEIVER", 160, 100);

    this.ctx.font = "16px Arial";
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillText(status, 160, 140);
  }

  private startStatusAnimation(): void {
    let frame = 0;
    const animate = () => {
      if (!this.animationId) return;

      // Add a subtle animation indicator
      const dots = ".".repeat(frame % 4);
      if (
        this.receivedPacketCount > 0 &&
        this.receivedPacketCount < this.expectedPackets
      ) {
        this.updateStatusCanvas(
          `Receiving ${this.receivedPacketCount}/${this.expectedPackets}${dots}`,
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
    this.onStateUpdate("idle");
  }

  cleanup(): void {
    this.stop();
    this.webrtc.cleanup();
    this.signalingChannel.close();
  }
}
