import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ExpeditionInfo,
  type Metric,
  expedition as baseExpedition,
  getStatus,
  metrics as initialMetrics,
} from "../data/mockData";
import { fetchSensorReport, type SensorReport } from "../api/sensorApi";
import { generateAlerts } from "./useSimulatedData";

export type LiveConnection = "disconnected" | "connecting" | "connected" | "error";

const POLL_MS = 1000;
const TREND_WINDOW = 7;

// The thermistor reads skin temperature; the "core-temp" metric, its range,
// and the alert thresholds are all on the body-core scale, so we add a fixed
// offset on the way in. Display-only — the firmware report is unchanged.
const SKIN_TO_CORE_OFFSET_C = 4.0;

function blankMetrics(): Metric[] {
  return initialMetrics.map((m) => ({
    ...m,
    value: 0,
    trend: [],
    status: "normal",
    placeholder: true,
  }));
}

function liveValueFor(id: string, report: SensorReport): number | null {
  if (id === "core-temp") return Number((report.thermistorC + SKIN_TO_CORE_OFFSET_C).toFixed(1));
  if (id === "sweat") return Math.round(report.moisturePct);
  if (id === "heart-rate") return report.heartRateBpm;
  return null;
}

function applyReport(
  base: Metric[],
  report: SensorReport,
  history: Record<string, number[]>,
): Metric[] {
  return base.map((m) => {
    const v = liveValueFor(m.id, report);
    if (v === null) return m;

    const trend = history[m.id] ?? [];
    trend.push(v);
    while (trend.length > TREND_WINDOW) trend.shift();
    history[m.id] = trend;
    return {
      ...m,
      value: v,
      trend: [...trend],
      status: getStatus(v, m.range),
      placeholder: false,
    };
  });
}

export function useLiveData(host: string | null) {
  const [metrics, setMetrics] = useState<Metric[]>(blankMetrics);
  const [connection, setConnection] = useState<LiveConnection>("disconnected");
  const historyRef = useRef<Record<string, number[]>>({});

  useEffect(() => {
    let cancelled = false;
    setConnection(host ? "connecting" : "disconnected");

    const tick = async () => {
      try {
        const report = await fetchSensorReport(host);
        if (cancelled) return;
        if (!report) {
          setConnection("disconnected");
          return;
        }
        setConnection("connected");
        setMetrics((prev) => applyReport(prev, report, historyRef.current));
      } catch {
        if (!cancelled) setConnection("error");
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [host]);

  const alerts = useMemo(() => {
    const byId = Object.fromEntries(metrics.map((m) => [m.id, m]));
    return generateAlerts(byId);
  }, [metrics]);

  return {
    metrics,
    expedition: baseExpedition as ExpeditionInfo,
    extremeAlerts: alerts.extreme,
    dailyAlerts: alerts.daily,
    connection,
  };
}
