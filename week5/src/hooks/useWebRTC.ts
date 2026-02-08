// src/hooks/useWebRTC.ts
import { useState, useEffect, useCallback, useRef } from "react";
import type { TransferRole } from "../types";

interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
  dataChannelState: RTCDataChannelState | null;
  createOffer: () => Promise<string>;
  receiveOffer: (offerString: string) => Promise<string>;
  receiveAnswer: (answerString: string) => Promise<void>;
  sendData: (data: string) => void;
  cleanup: () => void;
}

export const useWebRTC = (role: TransferRole): UseWebRTCReturn => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>("new");
  const [dataChannelState, setDataChannelState] =
    useState<RTCDataChannelState | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const createLocalStream = useCallback(async (): Promise<MediaStream> => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#1b1f2a";
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = "#4f7cff";
    ctx.font = "16px Arial";
    ctx.fillText(`${role.toUpperCase()} - DCT-LSB Steganography`, 20, 120);

    const stream = canvas.captureStream(10);
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, [role]);

  const initialize = useCallback(async () => {
    const config: RTCConfiguration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    const pc = new RTCPeerConnection(config);
    peerConnectionRef.current = pc;

    if (role === "sender") {
      const dc = pc.createDataChannel("ack-channel", {
        ordered: true,
        // 'reliable' is not a valid property - use 'maxRetransmits' or 'maxPacketLifeTime' instead
      });
      dataChannelRef.current = dc;
      setupDataChannel(dc);
    } else {
      pc.ondatachannel = (event) => {
        dataChannelRef.current = event.channel;
        setupDataChannel(event.channel);
      };
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("ICE candidate generated");
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnectionState(state);
      console.log("Connection state changed:", state);
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    if (role === "sender") {
      await createLocalStream();
      const stream = localStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });
      }
    }
  }, [role, createLocalStream]);

  const setupDataChannel = (dc: RTCDataChannel) => {
    dc.onopen = () => {
      setDataChannelState("open");
      console.log("Data channel opened");
    };

    dc.onclose = () => {
      setDataChannelState("closed");
      console.log("Data channel closed");
    };

    dc.onerror = (error) => {
      console.error("Data channel error:", error);
    };
  };

  const createOffer = useCallback(async (): Promise<string> => {
    if (!peerConnectionRef.current) {
      await initialize();
    }

    const offer = await peerConnectionRef.current!.createOffer();
    await peerConnectionRef.current!.setLocalDescription(offer);
    return JSON.stringify(offer);
  }, [initialize]);

  const receiveOffer = useCallback(
    async (offerString: string): Promise<string> => {
      if (!peerConnectionRef.current) {
        await initialize();
      }

      const offer = JSON.parse(offerString);
      await peerConnectionRef.current!.setRemoteDescription(
        new RTCSessionDescription(offer),
      );

      const answer = await peerConnectionRef.current!.createAnswer();
      await peerConnectionRef.current!.setLocalDescription(answer);

      return JSON.stringify(answer);
    },
    [initialize],
  );

  const receiveAnswer = useCallback(
    async (answerString: string): Promise<void> => {
      if (!peerConnectionRef.current) return;

      const answer = JSON.parse(answerString);
      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(answer),
      );
    },
    [],
  );

  const sendData = useCallback((data: string) => {
    if (dataChannelRef.current?.readyState === "open") {
      dataChannelRef.current.send(data);
    }
  }, []);

  const cleanup = useCallback(() => {
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());

    setLocalStream(null);
    setRemoteStream(null);
    setConnectionState("closed");
    setDataChannelState(null);

    peerConnectionRef.current = null;
    dataChannelRef.current = null;
    localStreamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    localStream,
    remoteStream,
    connectionState,
    dataChannelState,
    createOffer,
    receiveOffer,
    receiveAnswer,
    sendData,
    cleanup,
  };
};
