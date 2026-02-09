// src/modules/WebRTCManager.ts
export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  private onDataChannelMessage: ((data: ArrayBuffer | string) => void) | null =
    null;
  private onRemoteStream: ((stream: MediaStream) => void) | null = null;
  private onConnectionStateChange: ((state: string) => void) | null = null;
  private onIceCandidate: ((candidate: RTCIceCandidate) => void) | null = null;
  private onDataChannelOpen: (() => void) | null = null;

  private role: "sender" | "receiver";

  private candidateQueue: RTCIceCandidateInit[] = [];
  private isRemoteDescriptionSet = false;

  constructor(role: "sender" | "receiver") {
    this.role = role;
  }

  async initialize(): Promise<void> {
    const config: RTCConfiguration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    this.peerConnection = new RTCPeerConnection(config);
    this.candidateQueue = [];
    this.isRemoteDescriptionSet = false;

    if (this.role === "sender") {
      // Create data channel for file transfer with larger buffer
      this.dataChannel = this.peerConnection.createDataChannel(
        "file-transfer",
        {
          ordered: true,
          maxRetransmits: 10,
        },
      );
      this.setupDataChannel();
    } else {
      this.peerConnection.ondatachannel = (event) => {
        console.log("📡 Data channel received:", event.channel.label);
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("🧊 ICE candidate generated");
        this.onIceCandidate?.(event.candidate);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log("🔗 Connection state changed:", state);
      this.onConnectionStateChange?.(state || "");
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      console.log("🧊 ICE connection state:", state);
    };

    this.peerConnection.onicegatheringstatechange = () => {
      const state = this.peerConnection?.iceGatheringState;
      console.log("📊 ICE gathering state:", state);
    };

    this.peerConnection.ontrack = (event) => {
      console.log("🎥 Remote track received");
      console.log("   - Track kind:", event.track.kind);
      console.log("   - Track ID:", event.track.id);
      console.log("   - Stream count:", event.streams.length);

      if (event.streams.length > 0) {
        this.remoteStream = event.streams[0];
        console.log("   - Stream ID:", this.remoteStream.id);
        console.log("   - Stream active:", this.remoteStream.active);
        this.onRemoteStream?.(this.remoteStream);
      }
    };
  }

  setLocalStream(stream: MediaStream): void {
    console.log("📹 Setting local stream");
    console.log("   - Stream ID:", stream.id);
    console.log("   - Track count:", stream.getTracks().length);

    this.localStream = stream;

    if (this.peerConnection) {
      // Remove existing senders first (if any)
      const existingSenders = this.peerConnection.getSenders();
      if (existingSenders.length > 0) {
        console.log(
          "   - Removing",
          existingSenders.length,
          "existing senders",
        );
        existingSenders.forEach((sender) => {
          this.peerConnection?.removeTrack(sender);
        });
      }

      // Add new tracks
      stream.getTracks().forEach((track) => {
        console.log("   - Adding track:", track.kind, track.id);
        this.peerConnection?.addTrack(track, stream);
      });
      console.log("✅ All tracks added to peer connection");
    }
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    // Set binary type to arraybuffer for efficient binary data transfer
    this.dataChannel.binaryType = "arraybuffer";

    this.dataChannel.onopen = () => {
      console.log("✅ Data channel opened");
      console.log("   - Label:", this.dataChannel?.label);
      console.log("   - Ordered:", this.dataChannel?.ordered);
      console.log("   - Max retransmits:", this.dataChannel?.maxRetransmits);
      this.onDataChannelOpen?.();
    };

    this.dataChannel.onclose = () => {
      console.log("❌ Data channel closed");
    };

    this.dataChannel.onerror = (error) => {
      console.error("❌ Data channel error:", error);
    };

    this.dataChannel.onmessage = (event) => {
      this.onDataChannelMessage?.(event.data);
    };

    this.dataChannel.onbufferedamountlow = () => {
      console.log("📊 Data channel buffer low");
    };
  }

  async createOffer(): Promise<string> {
    if (!this.peerConnection)
      throw new Error("Peer connection not initialized");

    console.log("📨 Creating offer...");
    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: true,
    });

    await this.peerConnection.setLocalDescription(offer);
    console.log("✅ Local description set (offer)");

    // Wait for ICE gathering to complete
    await this.waitForIceGathering();

    const offerWithCandidates = this.peerConnection.localDescription;
    return JSON.stringify(offerWithCandidates);
  }

  async receiveOffer(offerString: string): Promise<string> {
    if (!this.peerConnection)
      throw new Error("Peer connection not initialized");

    console.log("📨 Receiving offer...");
    const offer = JSON.parse(offerString);

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(offer),
    );
    console.log("✅ Remote description set (offer)");

    this.isRemoteDescriptionSet = true;
    await this.processCandidateQueue();

    console.log("📨 Creating answer...");
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    console.log("✅ Local description set (answer)");

    // Wait for ICE gathering
    await this.waitForIceGathering();

    const answerWithCandidates = this.peerConnection.localDescription;
    return JSON.stringify(answerWithCandidates);
  }

  async receiveAnswer(answerString: string): Promise<void> {
    if (!this.peerConnection)
      throw new Error("Peer connection not initialized");

    console.log("📨 Receiving answer...");
    const answer = JSON.parse(answerString);
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer),
    );
    console.log("✅ Remote description set (answer)");

    this.isRemoteDescriptionSet = true;
    this.processCandidateQueue();
  }

  private waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.peerConnection) {
        resolve();
        return;
      }

      if (this.peerConnection.iceGatheringState === "complete") {
        console.log("✅ ICE gathering already complete");
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.log("⏱️ ICE gathering timeout");
        resolve();
      }, 3000);

      const checkState = () => {
        if (this.peerConnection?.iceGatheringState === "complete") {
          console.log("✅ ICE gathering complete");
          clearTimeout(timeout);
          resolve();
        }
      };

      this.peerConnection.addEventListener(
        "icegatheringstatechange",
        checkState,
      );

      const originalHandler = this.peerConnection.onicecandidate;
      this.peerConnection.onicecandidate = (event) => {
        if (originalHandler && this.peerConnection) {
          originalHandler.call(this.peerConnection, event);
        }
        if (!event.candidate) {
          console.log("✅ Received null ICE candidate (gathering complete)");
          clearTimeout(timeout);
          this.peerConnection?.removeEventListener(
            "icegatheringstatechange",
            checkState,
          );
          resolve();
        }
      };
    });
  }

  sendData(data: ArrayBuffer | string): boolean {
    if (this.dataChannel?.readyState === "open") {
      try {
        if (typeof data === "string") {
          this.dataChannel.send(data);
        } else {
          // For ArrayBuffer, send it directly
          this.dataChannel.send(data);
        }
        return true;
      } catch (error) {
        console.error("❌ Error sending data:", error);
        return false;
      }
    } else {
      console.warn(
        "⚠️ Cannot send data, channel state:",
        this.dataChannel?.readyState,
      );
      return false;
    }
  }

  getBufferedAmount(): number {
    return this.dataChannel?.bufferedAmount || 0;
  }

  setDataChannelMessageHandler(
    handler: (data: ArrayBuffer | string) => void,
  ): void {
    this.onDataChannelMessage = handler;
  }

  setDataChannelOpenHandler(handler: () => void): void {
    this.onDataChannelOpen = handler;
  }

  setRemoteStreamHandler(handler: (stream: MediaStream) => void): void {
    this.onRemoteStream = handler;
  }

  setIceCandidateHandler(handler: (candidate: RTCIceCandidate) => void): void {
    this.onIceCandidate = handler;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) return;

    if (this.isRemoteDescriptionSet) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
        console.log("✅ ICE candidate added");
      } catch (e) {
        console.error("❌ Error adding ICE candidate:", e);
      }
    } else {
      console.log("📋 Queuing ICE candidate");
      this.candidateQueue.push(candidate);
    }
  }

  private async processCandidateQueue(): Promise<void> {
    if (!this.peerConnection || this.candidateQueue.length === 0) return;

    console.log(
      `📋 Processing ${this.candidateQueue.length} queued ICE candidates`,
    );
    for (const candidate of this.candidateQueue) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch (e) {
        console.error("❌ Error adding queued ICE candidate:", e);
      }
    }
    this.candidateQueue = [];
  }

  setConnectionStateHandler(handler: (state: string) => void): void {
    this.onConnectionStateChange = handler;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  isDataChannelOpen(): boolean {
    return this.dataChannel?.readyState === "open";
  }

  cleanup(): void {
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.candidateQueue = [];
    this.isRemoteDescriptionSet = false;
  }
}
