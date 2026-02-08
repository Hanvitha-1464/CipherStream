// src/modules/WebRTCManager.ts
export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  private onDataChannelMessage: ((data: string) => void) | null = null;
  private onRemoteStream: ((stream: MediaStream) => void) | null = null;
  private onConnectionStateChange: ((state: string) => void) | null = null;

  constructor(private role: "sender" | "receiver") {}

  async initialize(): Promise<void> {
    const config: RTCConfiguration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    this.peerConnection = new RTCPeerConnection(config);

    if (this.role === "sender") {
      this.dataChannel = this.peerConnection.createDataChannel("ack-channel", {
        ordered: true,
      });
      this.setupDataChannel();
    } else {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("ICE candidate:", event.candidate);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      this.onConnectionStateChange?.(state || "");
      console.log("Connection state:", state);
    };

    this.peerConnection.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      this.onRemoteStream?.(this.remoteStream);
    };

    if (this.role === "sender") {
      await this.createLocalStream();
    }
  }

  private async createLocalStream(): Promise<void> {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#1b1f2a";
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = "#4f7cff";
    ctx.font = "16px Arial";
    ctx.fillText(`${this.role.toUpperCase()} - DCT-LSB Steganography`, 20, 120);

    this.localStream = canvas.captureStream(10);
    this.localStream.getTracks().forEach((track) => {
      this.peerConnection?.addTrack(track, this.localStream!);
    });
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log("Data channel opened");
    };

    this.dataChannel.onclose = () => {
      console.log("Data channel closed");
    };

    this.dataChannel.onmessage = (event) => {
      this.onDataChannelMessage?.(event.data);
    };
  }

  async createOffer(): Promise<string> {
    if (!this.peerConnection)
      throw new Error("Peer connection not initialized");

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    return JSON.stringify(offer);
  }

  async receiveOffer(offerString: string): Promise<string> {
    if (!this.peerConnection)
      throw new Error("Peer connection not initialized");

    const offer = JSON.parse(offerString);
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(offer),
    );

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    return JSON.stringify(answer);
  }

  async receiveAnswer(answerString: string): Promise<void> {
    if (!this.peerConnection)
      throw new Error("Peer connection not initialized");

    const answer = JSON.parse(answerString);
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer),
    );
  }

  sendData(data: string): void {
    if (this.dataChannel?.readyState === "open") {
      this.dataChannel.send(data);
    }
  }

  setDataChannelMessageHandler(handler: (data: string) => void): void {
    this.onDataChannelMessage = handler;
  }

  setRemoteStreamHandler(handler: (stream: MediaStream) => void): void {
    this.onRemoteStream = handler;
  }

  setConnectionStateHandler(handler: (state: string) => void): void {
    this.onConnectionStateChange = handler;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  // Add this method
  getSenders(): RTCRtpSender[] {
    if (!this.peerConnection) {
      return [];
    }
    return this.peerConnection.getSenders();
  }

  cleanup(): void {
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.localStream?.getTracks().forEach((track) => track.stop());
  }
}
