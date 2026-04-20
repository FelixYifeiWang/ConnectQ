import { useEffect, useRef, useState } from "react";
import {
  type Alert,
  type ExpeditionInfo,
  type Metric,
  type MetricRange,
  type MetricStatus,
  getStatus,
  expedition as baseExpedition,
  metrics as initialMetrics,
} from "../data/mockData";
import type { ScenarioPreset } from "../data/scenarioPresets";

// ── Simulation config per metric ──

type SimConfig = {
  volatility: number; // max magnitude of random step
  interval: number; // ticks between updates (1 tick = 1s)
  integer: boolean;
  decimals: number;
  drift: number; // directional bias per step (e.g. 0.4 = slight upward)
};

const SIM_TICK_MS = 1_000;

const simConfigs: Record<string, SimConfig> = {
  // Vitals
  "heart-rate":   { volatility: 5,    interval: 1,  integer: true,  decimals: 0, drift: 0 },
  "blood-oxygen": { volatility: 1,    interval: 1,  integer: true,  decimals: 0, drift: 0 },
  "hrv":          { volatility: 2,    interval: 1,  integer: true,  decimals: 0, drift: 0 },
  // Body
  "core-temp":    { volatility: 0.08, interval: 3,  integer: false, decimals: 1, drift: 0 },
  "sweat":        { volatility: 2,    interval: 2,  integer: true,  decimals: 0, drift: 0 },
};

// ── Helpers ──

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function getSubtitle(
  id: string,
  value: number,
  status: MetricStatus,
  _trend: number[],
): string | undefined {
  switch (id) {
    case "blood-oxygen":
      return status === "critical"
        ? "Critical"
        : status === "warning"
          ? "Low"
          : "Normal";
    case "hrv":
      return status === "critical"
        ? "Danger"
        : status === "warning"
          ? "Stressed"
          : "Recovered";
    case "core-temp":
      return status === "critical"
        ? "Danger"
        : status === "warning"
          ? "Watch"
          : "Normal";
    case "sweat":
      if (value >= 80) return "Drenched";
      if (value >= 55) return "Sweating";
      if (value >= 25) return "Moist";
      return "Dry";
    default:
      return undefined;
  }
}

// ── Dynamic alert generation ──

export function generateAlerts(
  metricsById: Record<string, Metric>,
): { extreme: Alert[]; daily: Alert[] } {
  const extreme: Alert[] = [];
  const daily: Alert[] = [];

  const spo2 = metricsById["blood-oxygen"];
  if (spo2?.status === "critical") {
    extreme.push({
      id: "e1",
      code: "E1",
      severity: "critical",
      message: "SpO\u2082 critical \u2014 descend now",
      channels: ["haptic", "audio", "thermal"],
      timestamp: "now",
      mode: "extreme",
    });
    daily.push({
      id: "d1",
      code: "D1",
      severity: "warning",
      message: "Blood oxygen dangerously low",
      channels: ["haptic", "audio"],
      timestamp: "now",
      mode: "daily",
    });
  } else if (spo2?.status === "warning") {
    extreme.push({
      id: "e2",
      code: "E2",
      severity: "warning",
      message: "Descend or rest",
      channels: ["haptic", "audio"],
      timestamp: "2m",
      mode: "extreme",
    });
    daily.push({
      id: "d1",
      code: "D1",
      severity: "info",
      message: "SpO\u2082 slightly low",
      channels: ["audio"],
      timestamp: "5m",
      mode: "daily",
    });
  }

  const hr = metricsById["heart-rate"];
  if (hr?.status === "critical") {
    extreme.push({
      id: "e3",
      code: "E3",
      severity: "critical",
      message: "Heart rate dangerously high",
      channels: ["haptic", "audio", "thermal"],
      timestamp: "now",
      mode: "extreme",
    });
    daily.push({
      id: "d2",
      code: "D2",
      severity: "warning",
      message: "Heart rate critical \u2014 stop activity",
      channels: ["haptic", "audio"],
      timestamp: "now",
      mode: "daily",
    });
  } else if (hr?.status === "warning") {
    daily.push({
      id: "d2",
      code: "D2",
      severity: "info",
      message: "Heart rate elevated \u2014 slow down",
      channels: ["haptic"],
      timestamp: "1m",
      mode: "daily",
    });
  }

  const ct = metricsById["core-temp"];
  if (ct?.status === "critical") {
    extreme.push({
      id: "e4",
      code: "E4",
      severity: "critical",
      message: "Hypothermia risk \u2014 warm up now",
      channels: ["haptic", "audio", "thermal"],
      timestamp: "now",
      mode: "extreme",
    });
  } else if (ct?.status === "warning") {
    extreme.push({
      id: "e5",
      code: "E5",
      severity: "warning",
      message: "Core temp dropping \u2014 add layers",
      channels: ["thermal"],
      timestamp: "3m",
      mode: "extreme",
    });
  }

  // Fallback: if nothing alarming, show baseline advisories
  if (daily.length === 0) {
    daily.push({
      id: "d3",
      code: "D3",
      severity: "info",
      message: "All vitals stable",
      channels: ["audio"],
      timestamp: "1m",
      mode: "daily",
    });
  }
  daily.push({
    id: "d4",
    code: "D4",
    severity: "info",
    message: "Time to drink",
    channels: ["thermal", "haptic"],
    timestamp: "12m",
    mode: "daily",
  });

  if (extreme.length === 0) {
    extreme.push({
      id: "e8",
      code: "E8",
      severity: "info",
      message: "Sensors nominal",
      channels: ["audio"],
      timestamp: "1m",
      mode: "extreme",
    });
  }

  return { extreme, daily };
}

// ── Mutable per-metric simulation state ──

// Compute a tight sparkRange centered on the current baseline so bars show
// meaningful variation instead of clustering at one height.
function dynamicSparkRange(
  baseline: number,
  cfg: SimConfig,
): [number, number] {
  const halfWindow = cfg.volatility * 1.5;
  return [baseline - halfWindow, baseline + halfWindow];
}

type SimState = {
  values: Record<string, number>;
  trends: Record<string, number[]>;
  ticks: Record<string, number>;
};

// ── Hook ──

export function useSimulatedData(scenario?: ScenarioPreset) {
  const stateRef = useRef<SimState | null>(null);
  const baselinesRef = useRef<Record<string, number>>({});

  // Initialize baselines from initial metrics
  if (!stateRef.current) {
    const values: Record<string, number> = {};
    const trends: Record<string, number[]> = {};
    const ticks: Record<string, number> = {};
    for (const m of initialMetrics) {
      values[m.id] = m.value;
      trends[m.id] = [...m.trend];
      ticks[m.id] = 0;
      baselinesRef.current[m.id] = m.value;
    }
    stateRef.current = { values, trends, ticks };
  }

  // When scenario changes: snap values, seed fresh trends, update expedition
  useEffect(() => {
    if (!scenario) return;
    if (scenario.interstitial) return; // stamp walls have no data
    const s = stateRef.current!;
    for (const [id, val] of Object.entries(scenario.metricBaselines)) {
      baselinesRef.current[id] = val;
      const cfg = simConfigs[id];
      if (!cfg) continue;

      // Snap to new baseline
      const snapped = cfg.integer ? Math.round(val) : Number(val.toFixed(cfg.decimals));
      s.values[id] = snapped;

      // Seed trend with visible variation around the new baseline
      // Use full volatility range so bars look distinct on first render
      const trend: number[] = [];
      const m = initialMetrics.find((im) => im.id === id);
      for (let i = 0; i < 7; i++) {
        const jitter = (Math.random() - 0.5) * cfg.volatility * 2.5;
        let v = val + jitter;
        if (m?.range) v = clamp(v, m.range.min, m.range.max);
        trend.push(cfg.integer ? Math.round(v) : Number(v.toFixed(cfg.decimals)));
      }
      trend[6] = snapped; // last point matches current value
      s.trends[id] = trend;

      // Reset tick counter so next update uses full interval
      s.ticks[id] = 0;
    }

    setExpedition({ ...baseExpedition, ...scenario.expedition });

    // Immediately push a fresh metrics snapshot so UI updates in sync
    const newMetrics: Metric[] = initialMetrics.map((m) => {
      const value = s.values[m.id];
      const trend = [...s.trends[m.id]];
      const status = getStatus(value, m.range);
      const subtitle = getSubtitle(m.id, value, status, trend);
      const cfg = simConfigs[m.id];
      const baseline = baselinesRef.current[m.id] ?? m.value;
      return {
        ...m,
        value,
        trend,
        status,
        ...(subtitle !== undefined ? { subtitle } : {}),
        ...(cfg && !cfg.integer ? { precision: cfg.decimals } : {}),
        ...(cfg ? { sparkRange: dynamicSparkRange(baseline, cfg) } : {}),
      };
    });
    setMetrics(newMetrics);

    const byId = Object.fromEntries(newMetrics.map((nm) => [nm.id, nm]));
    setAlerts(generateAlerts(byId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  const [metrics, setMetrics] = useState<Metric[]>(() =>
    initialMetrics.map((m) => {
      const cfg = simConfigs[m.id];
      return {
        ...m,
        precision: cfg?.integer === false ? cfg.decimals : undefined,
        ...(cfg ? { sparkRange: dynamicSparkRange(m.value, cfg) } : {}),
      };
    }),
  );
  const [expedition, setExpedition] = useState<ExpeditionInfo>(baseExpedition);
  const [alerts, setAlerts] = useState(() => {
    const byId = Object.fromEntries(initialMetrics.map((m) => [m.id, m]));
    return generateAlerts(byId);
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const s = stateRef.current!;
      let anyUpdated = false;

      for (const m of initialMetrics) {
        const cfg = simConfigs[m.id];
        if (!cfg) continue;

        s.ticks[m.id]++;
        if (s.ticks[m.id] < cfg.interval) continue;
        s.ticks[m.id] = 0;
        anyUpdated = true;

        // Random walk with mean-reversion toward current baseline
        const target = baselinesRef.current[m.id] ?? m.value;
        const noise = (Math.random() - 0.5 + cfg.drift * 0.5) * cfg.volatility * 2;
        const reversion = (target - s.values[m.id]) * 0.06;
        let next = s.values[m.id] + noise + reversion;

        if (m.range) {
          next = clamp(next, m.range.min, m.range.max);
        }

        if (cfg.integer) {
          next = Math.round(next);
        } else {
          next = Number(next.toFixed(cfg.decimals));
        }

        s.values[m.id] = next;

        // Shift trend window
        const trend = s.trends[m.id];
        trend.push(next);
        if (trend.length > 7) trend.shift();
      }

      if (!anyUpdated) return;

      const newMetrics: Metric[] = initialMetrics.map((m) => {
        const value = s.values[m.id];
        const trend = [...s.trends[m.id]];
        const status = getStatus(value, m.range);
        const subtitle = getSubtitle(m.id, value, status, trend);
        const cfg = simConfigs[m.id];
        const baseline = baselinesRef.current[m.id] ?? m.value;
        return {
          ...m,
          value,
          trend,
          status,
          ...(subtitle !== undefined ? { subtitle } : {}),
          ...(cfg && !cfg.integer ? { precision: cfg.decimals } : {}),
          ...(cfg ? { sparkRange: dynamicSparkRange(baseline, cfg) } : {}),
        };
      });

      setMetrics(newMetrics);

      // Regenerate alerts from current statuses
      const byId = Object.fromEntries(newMetrics.map((nm) => [nm.id, nm]));
      setAlerts(generateAlerts(byId));
    }, SIM_TICK_MS);

    return () => clearInterval(interval);
  }, []);

  return {
    metrics,
    expedition,
    extremeAlerts: alerts.extreme,
    dailyAlerts: alerts.daily,
  };
}
