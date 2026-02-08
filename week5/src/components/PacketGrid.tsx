// src/components/PacketGrid.tsx
import React from "react";

interface PacketStatus {
  sequence: number;
  state: "pending" | "sent" | "acked" | "retrying" | "failed";
  retries: number;
}

interface PacketGridProps {
  packets: PacketStatus[];
  totalPackets: number;
  title?: string;
}

const PacketGrid: React.FC<PacketGridProps> = ({
  packets,
  totalPackets,
  title = "Packet Status",
}) => {
  const getStateColor = (state: PacketStatus["state"]): string => {
    switch (state) {
      case "pending":
        return "var(--color-bg-muted)";
      case "sent":
        return "var(--color-warning)";
      case "acked":
        return "var(--color-success)";
      case "retrying":
        return "var(--color-warning)";
      case "failed":
        return "var(--color-error)";
      default:
        return "var(--color-bg-muted)";
    }
  };

  const getStateLabel = (state: PacketStatus["state"]): string => {
    switch (state) {
      case "pending":
        return "Pending";
      case "sent":
        return "Sent";
      case "acked":
        return "Acknowledged";
      case "retrying":
        return "Retrying";
      case "failed":
        return "Failed";
      default:
        return "Unknown";
    }
  };

  const displayedPackets =
    packets.length > 0
      ? packets
      : Array.from({ length: totalPackets }, (_, i) => ({
          sequence: i,
          state: "pending" as const,
          retries: 0,
        }));

  return (
    <div className="packet-panel">
      <h2 className="packet-title">{title}</h2>
      <div className="packet-grid">
        {displayedPackets.map((packet) => (
          <div
            key={packet.sequence}
            className="packet-item"
            style={{ backgroundColor: getStateColor(packet.state) }}
            title={`Packet ${packet.sequence} - ${getStateLabel(packet.state)}`}
          >
            <span className="packet-number">{packet.sequence}</span>
            {packet.retries > 0 && (
              <span className="retry-badge">{packet.retries}</span>
            )}
          </div>
        ))}
      </div>
      <div className="packet-legend">
        <div className="legend-item">
          <div
            className="legend-color"
            style={{ backgroundColor: getStateColor("pending") }}
          ></div>
          <span>Pending</span>
        </div>
        <div className="legend-item">
          <div
            className="legend-color"
            style={{ backgroundColor: getStateColor("sent") }}
          ></div>
          <span>Sent</span>
        </div>
        <div className="legend-item">
          <div
            className="legend-color"
            style={{ backgroundColor: getStateColor("acked") }}
          ></div>
          <span>Acknowledged</span>
        </div>
        <div className="legend-item">
          <div
            className="legend-color"
            style={{ backgroundColor: getStateColor("retrying") }}
          ></div>
          <span>Retrying</span>
        </div>
        <div className="legend-item">
          <div
            className="legend-color"
            style={{ backgroundColor: getStateColor("failed") }}
          ></div>
          <span>Failed</span>
        </div>
      </div>
      <div className="packet-summary">
        <span className="summary-item">Total: {totalPackets}</span>
        <span className="summary-item">
          Sent:{" "}
          {
            packets.filter(
              (p) =>
                p.state === "sent" ||
                p.state === "acked" ||
                p.state === "retrying",
            ).length
          }
        </span>
        <span className="summary-item">
          ACKed: {packets.filter((p) => p.state === "acked").length}
        </span>
        <span className="summary-item">
          Failed: {packets.filter((p) => p.state === "failed").length}
        </span>
      </div>
    </div>
  );
};

export default PacketGrid;
