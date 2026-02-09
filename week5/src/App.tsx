// App.tsx
import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import { SenderModule } from "./modules/SenderModule";
import { ReceiverModule } from "./modules/ReceiverModule";
import type {
  TransferRole,
  AppState,
  PacketStatus,
  TransferStats,
} from "./types";

function App() {
  const [role, setRole] = useState<TransferRole>("sender");
  const [appState, setAppState] = useState<AppState>("idle");
  const [transferStats, setTransferStats] = useState<TransferStats>({
    packetsSent: 0,
    packetsAcked: 0,
    bytesTransferred: 0,
    framesProcessed: 0,
    transferRate: 0,
    estimatedTimeRemaining: 0,
  });
  const [packetStatus, setPacketStatus] = useState<PacketStatus[]>([]);
  const [verificationResult, setVerificationResult] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const senderModule = useRef<SenderModule | null>(null);
  const receiverModule = useRef<ReceiverModule | null>(null);

  const handleRoleChange = (newRole: TransferRole) => {
    if (appState !== "idle") return;
    setRole(newRole);
    if (newRole === "sender") {
      receiverModule.current?.cleanup();
      receiverModule.current = null;
    } else {
      senderModule.current?.cleanup();
      senderModule.current = null;
    }
  };

  const handleStart = async () => {
    if (role === "sender") {
      if (!senderModule.current) {
        senderModule.current = new SenderModule(
          (stats: TransferStats) => setTransferStats(stats),
          (status: PacketStatus[]) => setPacketStatus(status),
          (state: AppState) => setAppState(state),
          (result: string) => setVerificationResult(result),
          () => setFileName(""),
          (name: string, size: number) => {
            setFileName(name);
            setFileSize(size);
          },
        );
      }
      if (selectedFile) {
        senderModule.current.setFile(selectedFile);
      }
      await senderModule.current.start();
    } else {
      if (!receiverModule.current) {
        receiverModule.current = new ReceiverModule(
          (stats: TransferStats) => setTransferStats(stats),
          (status: PacketStatus[]) => setPacketStatus(status),
          (state: AppState) => setAppState(state),
          (result: string) => setVerificationResult(result),
          (name: string, size: number) => {
            setFileName(name);
            setFileSize(size);
          },
        );
      }
      await receiverModule.current.start();
    }
  };

  const handleStop = () => {
    if (role === "sender") {
      senderModule.current?.stop();
    } else {
      receiverModule.current?.stop();
    }
    setAppState("idle");
    setVerificationResult("");
    setPacketStatus([]);
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (file && role === "sender") {
      console.log("File selected:", file.name, "size:", file.size);

      if (file.size !== 1024) {
        alert(
          `File must be exactly 1024 bytes (current size: ${file.size} bytes)`,
        );
        return;
      }

      // Reset file input to allow selecting same file again
      event.target.value = "";

      setSelectedFile(file);
      setFileName(file.name);
      setFileSize(file.size);
    }
  };

  useEffect(() => {
    return () => {
      senderModule.current?.cleanup();
      receiverModule.current?.cleanup();
    };
  }, []);

  // Convert TransferStats to display stats
  const displayStats = [
    { label: "Packets Sent", value: transferStats.packetsSent },
    { label: "Packets ACKed", value: transferStats.packetsAcked },
    { label: "Bytes Transferred", value: transferStats.bytesTransferred },
    { label: "Frames Processed", value: transferStats.framesProcessed },
  ];

  return (
    <div className="app">
      <header className="header">
        <h1>DCT-LSB Steganographic File Transfer</h1>
        <p className="subtitle">
          Transmit 1KB files via WebRTC video steganography
        </p>
      </header>

      <main className="main-content">
        <div className="control-panel">
          <div className="role-selector">
            <h2>Role Selection</h2>
            <div className="role-buttons">
              <button
                className={`role-btn ${role === "sender" ? "active" : ""}`}
                onClick={() => handleRoleChange("sender")}
                disabled={appState !== "idle"}
              >
                Sender
              </button>
              <button
                className={`role-btn ${role === "receiver" ? "active" : ""}`}
                onClick={() => handleRoleChange("receiver")}
                disabled={appState !== "idle"}
              >
                Receiver
              </button>
            </div>
          </div>

          <div className="file-info">
            <h2>File Information</h2>
            {role === "sender" ? (
              <div className="file-input">
                <label htmlFor="file-upload" className="file-label">
                  Select 1KB Text File
                </label>
                <input
                  id="file-upload"
                  type="file"
                  accept=".txt"
                  onChange={handleFileSelect}
                  disabled={appState !== "idle"}
                />
              </div>
            ) : null}
            {fileName && (
              <div className="file-details">
                <p>
                  <strong>File:</strong> {fileName}
                </p>
                <p>
                  <strong>Size:</strong> {fileSize} bytes
                </p>
              </div>
            )}
          </div>

          <div className="transfer-controls">
            <h2>Transfer Controls</h2>
            <div className="control-buttons">
              <button
                className="start-btn"
                onClick={handleStart}
                disabled={
                  appState !== "idle" || (role === "sender" && !fileName)
                }
              >
                Start Transfer
              </button>
              <button
                className="stop-btn"
                onClick={handleStop}
                disabled={appState === "idle"}
              >
                Stop
              </button>
            </div>
            <div className="state-indicator">
              <span className="state-label">State:</span>
              <span className={`state-value ${appState}`}>
                {appState.toUpperCase()}
              </span>
            </div>
          </div>

          {verificationResult && (
            <div
              className={`verification-result ${verificationResult.includes("SUCCESS") ? "success" : "error"}`}
            >
              <h2>Verification Result</h2>
              <p>{verificationResult}</p>
            </div>
          )}
        </div>

        <div className="video-panels">
          <div className="video-panel">
            <h2>{role === "sender" ? "Local Video" : "Remote Video"}</h2>
            <div className="video-container">
              <video
                id="localVideo"
                autoPlay
                muted
                playsInline
                className="video-element"
              />
            </div>
          </div>
          <div className="video-panel">
            <h2>{role === "sender" ? "Remote Video" : "Local Video"}</h2>
            <div className="video-container">
              <video
                id="remoteVideo"
                autoPlay
                playsInline
                className="video-element"
              />
            </div>
          </div>
        </div>

        <div className="status-panels">
          <div className="stats-panel">
            <h2>Transfer Statistics</h2>
            <div className="stats-grid">
              {displayStats.map((stat, index) => (
                <div key={index} className="stat-item">
                  <span className="stat-label">{stat.label}</span>
                  <span className="stat-value">{stat.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="packet-panel">
            <h2>Packet Status</h2>
            <div className="packet-grid">
              {packetStatus.map((pkt) => (
                <div
                  key={pkt.sequence}
                  className={`packet-item ${pkt.state}`}
                  title={`Packet ${pkt.sequence} - ${pkt.state}`}
                >
                  {pkt.sequence}
                  {pkt.retries > 0 && (
                    <span className="retry-badge">{pkt.retries}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="packet-legend">
              <div className="legend-item">
                <div className="legend-color pending"></div>
                <span>Pending</span>
              </div>
              <div className="legend-item">
                <div className="legend-color sent"></div>
                <span>Sent</span>
              </div>
              <div className="legend-item">
                <div className="legend-color acked"></div>
                <span>Acknowledged</span>
              </div>
              <div className="legend-item">
                <div className="legend-color retrying"></div>
                <span>Retrying</span>
              </div>
              <div className="legend-item">
                <div className="legend-color failed"></div>
                <span>Failed</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
