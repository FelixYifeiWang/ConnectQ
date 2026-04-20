// ── Types ──

export type MetricStatus = "normal" | "warning" | "critical";

export type MetricRange = {
  min: number;
  max: number;
  warningLow?: number;
  warningHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
};

export type AppMode = "daily" | "extreme";

export type Metric = {
  id: string;
  label: string;
  value: number;
  unit: string;
  icon: string;
  accentColor: string;
  trend: number[];
  section: "vitals" | "body";
  status: MetricStatus;
  range?: MetricRange;
  subtitle?: string;
  modes: AppMode[];
  precision?: number;
  sparkRange?: [number, number];
  // When true, the card renders "—" instead of a number. Used for LIVE metrics
  // that don't yet have a real sensor backing them.
  placeholder?: boolean;
};

export type AlertChannel = "haptic" | "audio" | "thermal";

export type Alert = {
  id: string;
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
  channels: AlertChannel[];
  timestamp: string;
  mode: AppMode;
};

export type ExpeditionInfo = {
  name: string;
  mountain: string;
  currentAltitude: number;
  targetAltitude: number;
  baseAltitude: number;
  campName: string;
  day: number;
  totalDays: number;
  weatherCondition: string;
  windDirection: string;
  sunrise: string;
  sunset: string;
};

// ── Helpers ──

export function getStatus(
  value: number,
  range?: MetricRange
): MetricStatus {
  if (!range) return "normal";
  if (
    (range.criticalLow !== undefined && value <= range.criticalLow) ||
    (range.criticalHigh !== undefined && value >= range.criticalHigh)
  )
    return "critical";
  if (
    (range.warningLow !== undefined && value <= range.warningLow) ||
    (range.warningHigh !== undefined && value >= range.warningHigh)
  )
    return "warning";
  return "normal";
}

// ── Expedition ──

export const expedition: ExpeditionInfo = {
  name: "Everest North Ridge",
  mountain: "Mt. Everest",
  currentAltitude: 7_162,
  targetAltitude: 8_849,
  baseAltitude: 5_150,
  campName: "Camp III — North Col",
  day: 18,
  totalDays: 42,
  weatherCondition: "Partly Cloudy",
  windDirection: "NW 48 km/h",
  sunrise: "06:12",
  sunset: "18:47",
};

// ── Metrics ──

const rawMetrics: Omit<Metric, "status">[] = [
  // ── Vitals (Pulse oximeter · ECG) ──
  {
    id: "heart-rate",
    label: "Heart Rate",
    value: 98,
    unit: "bpm",
    icon: "❤️",
    accentColor: "#FF6B8A",
    trend: [94, 96, 100, 97, 101, 95, 98],
    section: "vitals",
    modes: ["daily", "extreme"],
    range: { min: 40, max: 200, warningHigh: 120, criticalHigh: 150, warningLow: 50, criticalLow: 40 },
  },
  {
    id: "blood-oxygen",
    label: "SpO₂",
    value: 82,
    unit: "%",
    icon: "🫁",
    accentColor: "#5B8DEF",
    trend: [84, 83, 84, 82, 83, 81, 82],
    section: "vitals",
    modes: ["daily", "extreme"],
    subtitle: "Low",
    range: { min: 50, max: 100, warningLow: 85, criticalLow: 75 },
  },
  {
    id: "hrv",
    label: "HRV",
    value: 28,
    unit: "ms",
    icon: "💓",
    accentColor: "#A78BFA",
    trend: [31, 29, 32, 27, 30, 26, 28],
    section: "vitals",
    modes: ["extreme"],
    subtitle: "Stressed",
    range: { min: 10, max: 100, warningLow: 25, criticalLow: 15 },
  },

  // ── Body (Core temp · Sweat humidity) ──
  {
    id: "core-temp",
    label: "Temperature",
    value: 36.4,
    unit: "°C",
    icon: "🌡️",
    accentColor: "#F5A623",
    trend: [36.5, 36.5, 36.4, 36.5, 36.3, 36.4, 36.4],
    section: "body",
    modes: ["daily", "extreme"],
    subtitle: "Watch",
    range: { min: 34, max: 40, warningLow: 36.0, criticalLow: 35.0, warningHigh: 38.5, criticalHigh: 39.5 },
  },
  {
    id: "sweat",
    label: "Sweat",
    value: 32,
    unit: "%",
    icon: "💧",
    accentColor: "#60A5FA",
    trend: [30, 31, 33, 32, 34, 33, 32],
    section: "body",
    modes: ["daily", "extreme"],
    range: { min: 0, max: 100, warningHigh: 80, criticalHigh: 95 },
  },
];

// Apply status based on ranges
export const metrics: Metric[] = rawMetrics.map((m) => ({
  ...m,
  status: getStatus(m.value, m.range),
}));

// ── Alerts ──

export const extremeAlerts: Alert[] = [
  {
    id: "e2",
    code: "E2",
    severity: "warning",
    message: "Descend or rest",
    channels: ["haptic", "audio"],
    timestamp: "2m",
    mode: "extreme",
  },
  {
    id: "e4",
    code: "E4",
    severity: "warning",
    message: "Storm approaching",
    channels: ["haptic", "audio"],
    timestamp: "18m",
    mode: "extreme",
  },
];

export const dailyAlerts: Alert[] = [
  {
    id: "d3",
    code: "D3",
    severity: "info",
    message: "Recovery low — easy day",
    channels: ["audio", "thermal"],
    timestamp: "6:14 AM",
    mode: "daily",
  },
  {
    id: "d2",
    code: "D2",
    severity: "info",
    message: "Time to drink",
    channels: ["thermal", "haptic"],
    timestamp: "12m",
    mode: "daily",
  },
];

