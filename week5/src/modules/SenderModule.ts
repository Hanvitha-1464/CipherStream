// src/modules/SenderModule.ts
import type { AppState, PacketStatus, TransferStats } from "../types";
import { WebRTCManager } from "./WebRTCManager";
import { PacketProcessor } from "./PacketProcessor";
import { DCTSteganography } from "./DCTSteganography";

/* Callback types */
type StatsUpdateCallback = (stats: TransferStats) => void;
type StatusUpdateCallback = (status: PacketStatus[]) => void;
type StateUpdateCallback = (state: AppState) => void;
type ResultUpdateCallback = (result: string) => void;

export class SenderModule {
  /* callbacks (must be explicit fields) */
  private onStatsUpdate: StatsUpdateCallback;
  private onStatusUpdate: StatusUpdateCallback;
  private onStateUpdate: StateUpdateCallback;
  private onResultUpdate: ResultUpdateCallback;
  private onFileClear: () => void;
  private onFileSet: (name: string, size: number) => void;

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
  private isRunning = false;

  private framesSinceLastPacket = 0;
  private currentFragmentIndex = 0;
  private fragmentsPerPacket = 4;
  private waitingForAck = false;
  private ackTimeout: number | null = null;

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

    this.webrtc = new WebRTCManager("sender");

    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = 240;

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    this.ctx = ctx;

    this.webrtc.setConnectionStateHandler((state) => {
      if (state === "connected") {
        this.onStateUpdate("connected");
        this.startSending();
      }
    });

    this.webrtc.setDataChannelMessageHandler(this.handleAckMessage.bind(this));
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

    this.onStateUpdate("signaling");

    await this.webrtc.initialize();
    const offer = await this.webrtc.createOffer();

    const receiver = window.open(window.location.href);
    if (!receiver) {
      this.onResultUpdate("ERROR: Popups blocked");
      return;
    }

    setTimeout(() => {
      receiver.postMessage({ type: "offer", data: offer }, "*");
    }, 1000);

    window.addEventListener("message", this.handleSignalingMessage.bind(this));
  }

  private handleSignalingMessage(event: MessageEvent): void {
    if (event.data?.type === "answer") {
      this.webrtc.receiveAnswer(event.data.data);
    }
  }

  private handleAckMessage(data: string): void {
    const msg = JSON.parse(data);
    if (msg.type !== "ack") return;

    const seq = msg.sequenceNumber;
    if (!this.packetStatus[seq]) return;

    clearTimeout(this.ackTimeout!);
    this.packetStatus[seq].state = "acked";
    this.packetStatus[seq].retries = 0;
    this.onStatusUpdate(this.packetStatus);

    this.waitingForAck = false;
    this.currentPacketIndex++;

    if (this.currentPacketIndex >= this.packets.length) {
      this.onStateUpdate("complete");
      this.onResultUpdate("SUCCESS: File transfer completed");
      this.stop();
    } else {
      this.sendNextPacket();
    }
  }

  private startSending(): void {
    this.isRunning = true;
    this.onStateUpdate("sending");
    this.currentPacketIndex = 0;
    this.sendNextPacket();
    this.startAnimation();
  }

  private sendNextPacket(): void {
    if (!this.packetStatus[this.currentPacketIndex]) return;

    this.currentFragmentIndex = 0;
    this.framesSinceLastPacket = 0;
    this.waitingForAck = true;

    this.packetStatus[this.currentPacketIndex].state = "sent";
    this.onStatusUpdate(this.packetStatus);

    this.ackTimeout = window.setTimeout(() => this.retryCurrentPacket(), 500);
  }

  private retryCurrentPacket(): void {
    const status = this.packetStatus[this.currentPacketIndex];
    if (!status) return;

    if (status.retries >= 5) {
      status.state = "failed";
      this.onStateUpdate("error");
      this.onResultUpdate("ERROR: Max retries exceeded");
      this.stop();
      return;
    }

    status.state = "retrying";
    status.retries++;
    this.onStatusUpdate(this.packetStatus);
  }

  private startAnimation(): void {
    const loop = () => {
      if (!this.isRunning) return;

      if (this.waitingForAck) this.sendFrame();
      this.animationId = requestAnimationFrame(loop);
    };
    loop();
  }

  private sendFrame(): void {
    const packet = this.packets[this.currentPacketIndex];
    if (!packet) return;

    const fragmentSize = Math.ceil(packet.length / this.fragmentsPerPacket);
    const start = this.currentFragmentIndex * fragmentSize;
    const fragment = packet.slice(start, start + fragmentSize);

    const img = this.ctx.getImageData(0, 0, 320, 240);
    const modified = DCTSteganography.embedData(
      img,
      fragment,
      this.currentFragmentIndex,
    );
    this.ctx.putImageData(modified, 0, 0);

    this.currentFragmentIndex =
      (this.currentFragmentIndex + 1) % this.fragmentsPerPacket;
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this.ackTimeout) clearTimeout(this.ackTimeout);
    this.onStateUpdate("idle");
  }

  cleanup(): void {
    this.stop();
    this.webrtc.cleanup();
    this.file = null;
    this.fileData = null;
    this.isFileReady = false;
    this.fileLoadPromise = null;
    this.onFileClear();
  }
}
