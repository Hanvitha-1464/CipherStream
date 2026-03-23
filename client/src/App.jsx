import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeJson,
  decodeString,
  encodeBlobUrl,
  encodeJson,
  encodeString,
  maybeDecryptBytes,
  maybeEncryptBytes,
} from "./lib/crypto.js";
import { concatBytes } from "./lib/bytes.js";
import {
  appendPacketToEncodedFrame,
  extractPacketFromEncodedFrame,
  packetizeTransfer,
  unpackPacket,
} from "./lib/steganography.js";

const SIGNAL_URL = "http://localhost:3001";
const VIDEO_CONSTRAINTS = {
  audio: true,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  },
};
const PACKET_REPEAT_ROUNDS = 40;

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function createSignaling(url) {
  let socket;
  const listeners = new Map();
  return {
    connect() {
      socket = new WebSocket(url.replace(/^http/, "ws"));
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        listeners.get(message.type)?.(message.payload);
      });
      return socket;
    },
    emit(type, payload) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, payload }));
      }
    },
    on(type, handler) {
      listeners.set(type, handler);
    },
  };
}

export default function App() {
  const localVideoRef = useRef(null);
  const processedCanvasRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const queueRef = useRef([]);
  const extractorSeenRef = useRef(new Set());
  const transfersRef = useRef(new Map());
  const renderLoopRef = useRef(0);
  const roomCodeRef = useRef("");
  const joinedRoomRef = useRef("");
  const peerReadyRef = useRef(false);
  const politePeerRef = useRef(false);
  const senderTransformsRef = useRef(new WeakSet());
  const receiverTransformsRef = useRef(new WeakSet());
  const nextTransferIdRef = useRef(1);

  const [view, setView] = useState("landing");
  const [roomCode, setRoomCode] = useState("");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [status, setStatus] = useState("");
  const [callActive, setCallActive] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [message, setMessage] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [receivedMessages, setReceivedMessages] = useState([]);
  const [incomingFiles, setIncomingFiles] = useState([]);
  const [outgoingTransfers, setOutgoingTransfers] = useState([]);
  const [metrics, setMetrics] = useState({
    fps: 0,
    queueDepth: 0,
    packetsEmbedded: 0,
    packetsRecovered: 0,
    payloadOverhead: 0,
    latencyMs: 0,
  });

  const signaling = useMemo(() => createSignaling(SIGNAL_URL), []);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    joinedRoomRef.current = joinedRoom;
  }, [joinedRoom]);

  useEffect(() => {
    syncLocalVideo();

    const remoteVideo = remoteVideoRef.current;
    if (remoteVideo) {
      remoteVideo.srcObject = remoteReady ? remoteStreamRef.current : null;
      if (remoteReady && remoteStreamRef.current) {
        remoteVideo.play().catch(() => {});
      }
    }

    if ((view === "lobby" || view === "call") && localStreamRef.current) {
      startPreviewLoop();
    }
  }, [view, remoteReady]);

  useEffect(() => {
    const socket = signaling.connect();

    signaling.on("room-joined", ({ roomCode: code }) => {
      joinedRoomRef.current = code;
      setJoinedRoom(code);
      setStatus(`Joined secure room ${code}`);
    });

    signaling.on("peer-ready", async ({ polite }) => {
      peerReadyRef.current = true;
      politePeerRef.current = polite;
      await ensurePeerConnection(polite, codeOrRoom());
    });

    signaling.on("signal", async ({ description, candidate }) => {
      await ensurePeerConnection(true, codeOrRoom());
      const peer = peerRef.current;
      if (!peer) return;

      if (description) {
        const readyForOffer = !peer.makingOffer && (peer.connection.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
        const offerCollision = description.type === "offer" && !readyForOffer;
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        peer.isSettingRemoteAnswerPending = description.type === "answer";
        await peer.connection.setRemoteDescription(description);
        peer.isSettingRemoteAnswerPending = false;

        if (description.type === "offer") {
          await peer.connection.setLocalDescription(await peer.connection.createAnswer());
          signaling.emit("signal", {
            roomCode: codeOrRoom(),
            description: peer.connection.localDescription,
          });
        }
      } else if (candidate) {
        try {
          await peer.connection.addIceCandidate(candidate);
        } catch (error) {
          if (!peer.ignoreOffer) console.error(error);
        }
      }
    });

    socket.addEventListener("open", () => {});
    return () => socket.close();
  }, [signaling]);

  function codeOrRoom() {
    return joinedRoomRef.current || roomCodeRef.current;
  }

  const attachLocalVideo = useCallback((node) => {
    localVideoRef.current = node;
    if (!node || !localStreamRef.current) return;
    node.srcObject = localStreamRef.current;
    node.play().catch(() => {});
  }, []);

  const attachRemoteVideo = useCallback((node) => {
    remoteVideoRef.current = node;
    if (!node) return;
    node.srcObject = remoteReady ? remoteStreamRef.current : null;
    if (remoteReady && remoteStreamRef.current) {
      node.play().catch(() => {});
    }
  }, [remoteReady]);

  function syncLocalVideo() {
    const localVideo = localVideoRef.current;
    if (!localVideo || !localStreamRef.current) return;
    localVideo.srcObject = localStreamRef.current;
    localVideo.play().catch(() => {});
  }

  function setupSenderTransform(sender) {
    if (!sender || senderTransformsRef.current.has(sender)) return;
    if (typeof sender.createEncodedStreams !== "function") {
      setStatus("Encoded video transforms are not supported in this browser.");
      return;
    }

    const { readable, writable } = sender.createEncodedStreams();
    const transform = new TransformStream({
      transform: (frame, controller) => {
        const queued = queueRef.current[0];
        if (queued) {
          const ok = appendPacketToEncodedFrame(frame, queued.packet);
          if (ok) {
            queued.roundsLeft -= 1;
            if (queued.roundsLeft <= 0) {
              queueRef.current.shift();
            }
            if (!queued.accounted) {
              queued.accounted = true;
              setOutgoingTransfers((current) =>
                current.map((item) =>
                  item.transferId === queued.transferId
                    ? { ...item, sentPackets: Math.min(item.sentPackets + 1, item.totalPackets) }
                    : item,
                ),
              );
            }
            setMetrics((current) => ({
              ...current,
              packetsEmbedded: current.packetsEmbedded + 1,
              queueDepth: queueRef.current.length,
              payloadOverhead: Number(
                ((queued.packet.byteLength / Math.max(1, frame.data.byteLength)) * 100).toFixed(2),
              ),
            }));
          }
        } else {
          setMetrics((current) => ({ ...current, queueDepth: 0 }));
        }
        controller.enqueue(frame);
      },
    });

    readable.pipeThrough(transform).pipeTo(writable);
    senderTransformsRef.current.add(sender);
  }

  function setupReceiverTransform(receiver) {
    if (!receiver || receiverTransformsRef.current.has(receiver)) return;
    if (typeof receiver.createEncodedStreams !== "function") {
      setStatus("Encoded video transforms are not supported in this browser.");
      return;
    }

    const { readable, writable } = receiver.createEncodedStreams();
    const transform = new TransformStream({
      transform: async (frame, controller) => {
        const startedAt = performance.now();
        const packet = extractPacketFromEncodedFrame(frame);
        if (packet) {
          await processIncomingPacket(packet);
          setMetrics((current) => ({
            ...current,
            packetsRecovered: current.packetsRecovered + 1,
            latencyMs: Number((performance.now() - startedAt).toFixed(2)),
          }));
        }
        controller.enqueue(frame);
      },
    });

    readable.pipeThrough(transform).pipeTo(writable);
    receiverTransformsRef.current.add(receiver);
  }

  async function ensurePeerConnection(polite, targetRoom) {
    if (peerRef.current) return peerRef.current;
    if (!localStreamRef.current) return null;

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      encodedInsertableStreams: true,
    });

    const peer = {
      connection,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
    };

    connection.onicecandidate = ({ candidate }) => {
      signaling.emit("signal", { roomCode: targetRoom, candidate });
    };

    connection.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await connection.setLocalDescription(await connection.createOffer());
        signaling.emit("signal", {
          roomCode: targetRoom,
          description: connection.localDescription,
        });
      } finally {
        peer.makingOffer = false;
      }
    };

    connection.ontrack = (event) => {
      if (event.track.kind === "video") {
        setupReceiverTransform(event.receiver);
      }

      remoteStreamRef.current = event.streams[0] || null;
      if (remoteVideoRef.current && remoteStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
        remoteVideoRef.current.play().catch(() => {});
      }
      setRemoteReady(Boolean(remoteStreamRef.current));
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      setStatus(`Peer state: ${state}`);
      setCallActive(state === "connected");
      if (["failed", "closed", "disconnected"].includes(state)) {
        remoteStreamRef.current = null;
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
        setRemoteReady(false);
      }
    };

    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      const sender = connection.addTrack(videoTrack, localStreamRef.current);
      setupSenderTransform(sender);
    }
    localStreamRef.current.getAudioTracks().forEach((track) =>
      connection.addTrack(track, localStreamRef.current),
    );

    peerRef.current = peer;
    return peer;
  }

  async function startCamera() {
    const trimmedRoomCode = roomCode.trim();
    if (!trimmedRoomCode) {
      setStatus("Enter a room ID to continue.");
      return;
    }

    if (trimmedRoomCode !== roomCode) {
      setRoomCode(trimmedRoomCode);
    }
    roomCodeRef.current = trimmedRoomCode;
    setView("lobby");

    if (localStreamRef.current) {
      setStatus("");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
    localStreamRef.current = stream;
    syncLocalVideo();
    startPreviewLoop();
    setStatus("");
  }

  async function joinCall() {
    const trimmedRoomCode = roomCode.trim();
    if (!trimmedRoomCode) {
      setStatus("Enter a room ID to continue.");
      return;
    }

    if (!localStreamRef.current) {
      await startCamera();
    }

    remoteStreamRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setRemoteReady(false);
    setView("call");
    roomCodeRef.current = trimmedRoomCode;
    signaling.emit("join-room", { roomCode: trimmedRoomCode });
  }

  async function sendMessage() {
    if (!message.trim()) return;
    const metadata = encodeJson({
      label: "Secret message",
      mimeType: "text/plain",
      kind: "message",
      createdAt: new Date().toISOString(),
    });
    const encryptedPayload = await maybeEncryptBytes(encodeString(message.trim()), passphrase);
    enqueueTransfer({
      type: 1,
      label: "Message",
      payload: encryptedPayload.data,
      metadata,
      encrypted: encryptedPayload.encrypted,
    });
    setMessage("");
  }

  async function sendFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = encodeJson({
      label: file.name,
      mimeType: file.type || "application/octet-stream",
      kind: "file",
      size: bytes.length,
      createdAt: new Date().toISOString(),
    });
    const encryptedPayload = await maybeEncryptBytes(bytes, passphrase);
    enqueueTransfer({
      type: 2,
      label: file.name,
      payload: encryptedPayload.data,
      metadata,
      encrypted: encryptedPayload.encrypted,
    });
  }

  function enqueueTransfer({ type, label, payload, metadata, encrypted }) {
    const transferId = nextTransferIdRef.current;
    nextTransferIdRef.current = (nextTransferIdRef.current % 65535) + 1;
    const packets = packetizeTransfer(transferId, type, payload, metadata, encrypted);
    const scheduled = [];

    for (let round = 0; round < PACKET_REPEAT_ROUNDS; round += 1) {
      for (let index = 0; index < packets.length; index += 1) {
        scheduled.push({
          packet: packets[index],
          transferId,
          label,
          packetIndex: index + 1,
          totalPackets: packets.length,
          roundsLeft: 1,
          accounted: round > 0,
        });
      }
    }

    queueRef.current.push(...scheduled);
    setOutgoingTransfers((current) => [
      { transferId, label, totalPackets: packets.length, sentPackets: 0 },
      ...current.filter((item) => item.transferId !== transferId),
    ]);
    setMetrics((current) => ({ ...current, queueDepth: queueRef.current.length }));
  }

  function startPreviewLoop() {
    cancelAnimationFrame(renderLoopRef.current);
    const canvas = processedCanvasRef.current;
    const video = localVideoRef.current;
    if (!canvas || !video) return;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    let lastFrameAt = performance.now();
    let smoothedFps = 0;

    const render = () => {
      if (video?.readyState >= 2) {
        canvas.width = 1280;
        canvas.height = 720;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const now = performance.now();
        const fps = 1000 / Math.max(1, now - lastFrameAt);
        smoothedFps = smoothedFps === 0 ? fps : smoothedFps * 0.9 + fps * 0.1;
        lastFrameAt = now;
        setMetrics((current) => ({ ...current, fps: Number(smoothedFps.toFixed(1)) }));
      }
      renderLoopRef.current = requestAnimationFrame(render);
    };

    renderLoopRef.current = requestAnimationFrame(render);
  }

  async function processIncomingPacket(packetBytes) {
    const packet = unpackPacket(packetBytes);
    if (!packet) return;

    const dedupeKey = `${packet.transferId}:${packet.packetIndex}`;
    if (extractorSeenRef.current.has(dedupeKey)) return;
    extractorSeenRef.current.add(dedupeKey);

    const transfer = transfersRef.current.get(packet.transferId) ?? {
      type: packet.type,
      encrypted: packet.encrypted,
      totalPackets: packet.totalPackets,
      chunks: new Map(),
      metadata: packet.metadata,
    };

    if (packet.metadata.length > 0) {
      transfer.metadata = packet.metadata;
    }

    transfer.chunks.set(packet.packetIndex, packet.payload);
    transfersRef.current.set(packet.transferId, transfer);
    if (transfer.chunks.size !== transfer.totalPackets) return;

    const ordered = Array.from({ length: transfer.totalPackets }, (_, index) => transfer.chunks.get(index));
    const payload = concatBytes(ordered);
    const metadata = decodeJson(transfer.metadata);
    const plainBytes = await maybeDecryptBytes(payload, passphrase, transfer.encrypted);

    if (metadata.kind === "message") {
      setReceivedMessages((current) => [
        {
          id: `${packet.transferId}-${Date.now()}`,
          text: decodeString(plainBytes),
          encrypted: transfer.encrypted,
        },
        ...current,
      ]);
    } else {
      const blob = new Blob([plainBytes], { type: metadata.mimeType });
      const url = URL.createObjectURL(blob);
      setIncomingFiles((current) => [
        {
          id: `${packet.transferId}-${Date.now()}`,
          label: metadata.label,
          mimeType: metadata.mimeType,
          size: plainBytes.length,
          encrypted: transfer.encrypted,
          url,
          preview: metadata.mimeType.startsWith("image/") ? encodeBlobUrl(plainBytes) : "",
        },
        ...current,
      ]);
    }

    transfersRef.current.delete(packet.transferId);
  }

  const showSupportPanels = view === "call";

  return (
    <div className="page-shell app-shell">
      {view === "landing" ? (
        <section className="landing-stage">
          <div className="landing-copy">
            <p className="eyebrow">Peer-to-peer encoded media covert transfer</p>
            <h1>CipherStream</h1>
          </div>
          <div className="landing-card">
            <label>
              Room ID
              <input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} placeholder="Enter room id" />
            </label>
            <button onClick={startCamera}>Join</button>
            <p className="status-line">{status}</p>
          </div>
        </section>
      ) : null}

      {view === "lobby" ? (
        <section className="stage-panel">
          <div className="stage-header">
            <div>
              <p className="eyebrow">Lobby</p>
              <h2>Preview Before Joining</h2>
            </div>
            <div className="room-pill">Room {roomCode}</div>
          </div>
          <div className="single-video-wrap">
            <video ref={attachLocalVideo} autoPlay muted playsInline className="video-frame hero-video" />
          </div>
          <div className="lobby-actions">
            <button onClick={joinCall}>Join Call</button>
            <span className="status-line">{status}</span>
          </div>
          <canvas ref={processedCanvasRef} className="hidden-preview" />
        </section>
      ) : null}

      {view === "call" ? (
        <>
          <section className="stage-panel">
            <div className="stage-header">
              <div>
                <p className="eyebrow">Live Session</p>
                <h2>Secure Call</h2>
              </div>
              <div className="room-pill">Room {joinedRoom || roomCode}</div>
            </div>
            <div className="call-grid two-up">
              <div className="call-card">
                <div className="panel-header"><h3>You</h3><span>Local preview</span></div>
                <video ref={attachLocalVideo} autoPlay muted playsInline className="video-frame hero-video" />
              </div>
              <div className="call-card remote-card">
                <div className="panel-header"><h3>Remote peer</h3><span>{remoteReady ? "Connected" : "Waiting"}</span></div>
                <video ref={attachRemoteVideo} autoPlay playsInline className="video-frame hero-video" />
                {!remoteReady ? <div className="waiting-overlay">Waiting for the other person to join</div> : null}
              </div>
            </div>
            <canvas ref={processedCanvasRef} className="hidden-preview" />
          </section>

          {showSupportPanels ? (
            <div className="support-stack">
              <div className="support-grid top-grid">
                <section className="panel">
                  <div className="panel-header"><h2>Hidden message</h2></div>
                  <textarea rows="5" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type your message here" />
                  <button onClick={sendMessage}>Send message</button>
                </section>
                <section className="panel">
                  <div className="panel-header"><h2>Hidden file</h2></div>
                  <label className="file-picker">
                    <input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) sendFile(file); }} />
                    Select file for transfer
                  </label>
                  <div className="transfer-list">
                    {outgoingTransfers.map((item) => (
                      <div key={item.transferId} className="transfer-card">
                        <strong>{item.label}</strong>
                        <span>{item.sentPackets}/{item.totalPackets} packets transmitted</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="support-grid bottom-grid">
                <section className="panel">
                  <div className="panel-header"><h2>Security and performance</h2><span>Assignment-aligned metrics</span></div>
                  <div className="metric-grid">
                    <div className="metric-card"><strong>{metrics.fps}</strong><span>preview fps</span></div>
                    <div className="metric-card"><strong>{metrics.latencyMs}</strong><span>extract latency ms</span></div>
                    <div className="metric-card"><strong>{metrics.payloadOverhead}</strong><span>payload overhead %</span></div>
                    <div className="metric-card"><strong>{metrics.packetsEmbedded}</strong><span>packets embedded</span></div>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-header"><h2>Recovered messages</h2><span>{receivedMessages.length} complete</span></div>
                  <div className="transfer-list">
                    {receivedMessages.length === 0 ? <p className="empty">No recovered messages yet.</p> : null}
                    {receivedMessages.map((item) => (
                      <div key={item.id} className="transfer-card">
                        <strong>{item.encrypted ? "Encrypted message" : "Message"}</strong>
                        <span>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-header"><h2>Recovered files</h2><span>{incomingFiles.length} ready</span></div>
                  <div className="transfer-list">
                    {incomingFiles.length === 0 ? <p className="empty">No recovered files yet.</p> : null}
                    {incomingFiles.map((item) => (
                      <div key={item.id} className="transfer-card">
                        <strong>{item.label}</strong>
                        <span>{formatBytes(item.size)} | {item.encrypted ? "encrypted" : "plain"}</span>
                        {item.preview ? (
                          <img className="preview-image" alt={item.label} src={`data:${item.mimeType};base64,${item.preview}`} />
                        ) : null}
                        <a href={item.url} download={item.label}>Download recovered file</a>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
