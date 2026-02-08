// src/constants/colors.ts
export const COLORS = {
  // Background colors
  bg: "#0f1115",
  bgMuted: "#151821",
  bgElevated: "#1b1f2a",

  // Border colors
  border: "#2a2f3a",
  borderStrong: "#3a4050",

  // Text colors
  text: "#e6e8ee",
  textMuted: "#a3a8b8",
  textSubtle: "#6b7280",

  // Primary colors
  primary: "#4f7cff",
  primaryHover: "#3c68e0",
  primaryActive: "#2f56c7",

  // Status colors
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  info: "#38bdf8",

  // UI element colors
  progressBg: "#1f2430",
  progressFill: "#4f7cff",
  focusRing: "#93c5fd",

  // Packet state colors
  packetPending: "#2a2f3a",
  packetSent: "#f59e0b",
  packetAcked: "#22c55e",
  packetRetrying: "#f59e0b",
  packetFailed: "#ef4444",
} as const;

export const CSS_VARIABLES = Object.entries(COLORS).reduce(
  (acc, [key, value]) => ({
    ...acc,
    [`--color-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`]: value,
  }),
  {},
);

export const STATE_COLORS: Record<string, string> = {
  idle: COLORS.textSubtle,
  signaling: COLORS.info,
  connected: COLORS.success,
  sending: COLORS.warning,
  receiving: COLORS.warning,
  verifying: COLORS.primary,
  complete: COLORS.success,
  error: COLORS.error,
};
