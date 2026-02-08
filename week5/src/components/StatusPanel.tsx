// src/components/StatusPanel.tsx
import React from "react";

interface StatItem {
  label: string;
  value: number | string;
  color?: string;
}

interface StatusPanelProps {
  title: string;
  stats: StatItem[];
  compact?: boolean;
}

const StatusPanel: React.FC<StatusPanelProps> = ({
  title,
  stats,
  compact = false,
}) => {
  return (
    <div className={`stats-panel ${compact ? "compact" : ""}`}>
      <h2 className="stats-title">{title}</h2>
      <div className={`stats-grid ${compact ? "stats-grid-compact" : ""}`}>
        {stats.map((stat, index) => (
          <div key={index} className="stat-item">
            <span className="stat-label">{stat.label}</span>
            <span
              className="stat-value"
              style={stat.color ? { color: stat.color } : undefined}
            >
              {stat.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StatusPanel;
