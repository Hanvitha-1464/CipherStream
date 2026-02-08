// src/components/ControlPanel.tsx
import React from "react";
import type { ChangeEvent } from "react";

// Define types locally to avoid import issues
type TransferRole = "sender" | "receiver";
type AppState =
  | "idle"
  | "signaling"
  | "connected"
  | "sending"
  | "receiving"
  | "verifying"
  | "complete"
  | "error";

interface ControlPanelProps {
  role: TransferRole;
  appState: AppState;
  fileName?: string;
  fileSize?: number;
  onRoleChange: (role: TransferRole) => void;
  onStart: () => void;
  onStop: () => void;
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  verificationResult?: string;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  role,
  appState,
  fileName,
  fileSize,
  onRoleChange,
  onStart,
  onStop,
  onFileSelect,
  verificationResult,
}) => {
  const isIdle = appState === "idle";
  const hasFile = !!fileName && fileSize === 1024;
  const canStart =
    isIdle && (role === "receiver" || (role === "sender" && hasFile));

  return (
    <div className="control-panel">
      <div className="role-selector">
        <h2>Role Selection</h2>
        <div className="role-buttons">
          <button
            className={`role-btn ${role === "sender" ? "active" : ""}`}
            onClick={() => onRoleChange("sender")}
            disabled={!isIdle}
          >
            Sender
          </button>
          <button
            className={`role-btn ${role === "receiver" ? "active" : ""}`}
            onClick={() => onRoleChange("receiver")}
            disabled={!isIdle}
          >
            Receiver
          </button>
        </div>
      </div>

      <div className="file-info">
        <h2>File Information</h2>
        {role === "sender" && (
          <div className="file-input">
            <label htmlFor="file-upload" className="file-label">
              Select 1KB Text File
            </label>
            <input
              id="file-upload"
              type="file"
              accept=".txt"
              onChange={onFileSelect}
              disabled={!isIdle}
            />
          </div>
        )}
        {fileName && (
          <div className="file-details">
            <p>
              <strong>File:</strong> {fileName}
            </p>
            <p>
              <strong>Size:</strong> {fileSize} bytes
            </p>
            <p>
              <strong>Type:</strong> Text file
            </p>
          </div>
        )}
      </div>

      <div className="transfer-controls">
        <h2>Transfer Controls</h2>
        <div className="control-buttons">
          <button className="start-btn" onClick={onStart} disabled={!canStart}>
            Start Transfer
          </button>
          <button className="stop-btn" onClick={onStop} disabled={isIdle}>
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
          className={`verification-result ${
            verificationResult.includes("SUCCESS") ? "success" : "error"
          }`}
        >
          <h2>Verification Result</h2>
          <p>{verificationResult}</p>
        </div>
      )}
    </div>
  );
};

export default ControlPanel;
