import React from "react";

interface StatItemProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
}

const StatItem: React.FC<StatItemProps> = ({
  label,
  value,
  unit = "",
  color = "text-green-400",
}) => {
  return (
    <div className="mb-3 p-3 bg-gray-800 rounded-lg transition-all hover:bg-gray-750">
      <div className="font-semibold text-gray-300 text-sm mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>
        {value} {unit}
      </div>
    </div>
  );
};

export default StatItem;
