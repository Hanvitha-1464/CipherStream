// src/hooks/useTransferState.ts
import { useState, useCallback } from "react";
import type {
  TransferRole,
  AppState,
  PacketStatus,
  TransferStats,
} from "../types";

interface UseTransferStateReturn {
  role: TransferRole;
  appState: AppState;
  fileName: string;
  fileSize: number;
  transferStats: TransferStats;
  packetStatus: PacketStatus[];
  verificationResult: string;
  setRole: (role: TransferRole) => void;
  setAppState: (state: AppState) => void;
  setFileInfo: (name: string, size: number) => void;
  setTransferStats: (stats: TransferStats) => void;
  updateTransferStats: (updates: Partial<TransferStats>) => void;
  setPacketStatus: (status: PacketStatus[]) => void;
  updatePacketStatus: (
    sequence: number,
    updates: Partial<PacketStatus>,
  ) => void;
  setVerificationResult: (result: string) => void;
  resetState: () => void;
}

export const useTransferState = (): UseTransferStateReturn => {
  const [role, setRole] = useState<TransferRole>("sender");
  const [appState, setAppState] = useState<AppState>("idle");
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
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

  const setFileInfo = useCallback((name: string, size: number) => {
    setFileName(name);
    setFileSize(size);
  }, []);

  const updateTransferStats = useCallback((updates: Partial<TransferStats>) => {
    setTransferStats((prev) => ({ ...prev, ...updates }));
  }, []);

  const updatePacketStatus = useCallback(
    (sequence: number, updates: Partial<PacketStatus>) => {
      setPacketStatus((prev) =>
        prev.map((packet) =>
          packet.sequence === sequence ? { ...packet, ...updates } : packet,
        ),
      );
    },
    [],
  );

  const resetState = useCallback(() => {
    setAppState("idle");
    setFileName("");
    setFileSize(0);
    setTransferStats({
      packetsSent: 0,
      packetsAcked: 0,
      bytesTransferred: 0,
      framesProcessed: 0,
      transferRate: 0,
      estimatedTimeRemaining: 0,
    });
    setPacketStatus([]);
    setVerificationResult("");
  }, []);

  const handleRoleChange = useCallback(
    (newRole: TransferRole) => {
      if (appState === "idle") {
        setRole(newRole);
        resetState();
      }
    },
    [appState, resetState],
  );

  return {
    role,
    appState,
    fileName,
    fileSize,
    transferStats,
    packetStatus,
    verificationResult,
    setRole: handleRoleChange,
    setAppState,
    setFileInfo,
    setTransferStats,
    updateTransferStats,
    setPacketStatus,
    updatePacketStatus,
    setVerificationResult,
    resetState,
  };
};
