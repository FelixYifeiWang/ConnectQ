import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { AppMode, Metric } from "../data/mockData";

type Props = {
  metric: Metric;
  mode: AppMode;
  delay?: number;
  fullWidth?: boolean;
};

const statusBorder = {
  extreme: {
    normal: "rgba(168,162,158,0.10)",
    warning: "rgba(251,191,36,0.30)",
    critical: "rgba(248,113,113,0.40)",
  },
  daily: {
    normal: "rgba(107,114,128,0.12)",
    warning: "rgba(251,191,36,0.20)",
    critical: "rgba(248,113,113,0.25)",
  },
} as const;

const statusBg = {
  extreme: {
    normal: "#1C1917",
    warning: "rgba(251,191,36,0.05)",
    critical: "rgba(248,113,113,0.05)",
  },
  daily: {
    normal: "#111827",
    warning: "rgba(251,191,36,0.04)",
    critical: "rgba(248,113,113,0.04)",
  },
} as const;

function Sparkline({
  data,
  color,
  active,
  entranceDelay,
  sparkRange,
}: {
  data: number[];
  color: string;
  active: boolean;
  entranceDelay: number;
  sparkRange?: [number, number];
}) {
  // Grow the per-bar Animated.Value arrays to match incoming data. LIVE mode
  // starts with trend=[] and pushes up to TREND_WINDOW, so a mount-time useRef
  // snapshot would leave barHeights[i] undefined for later bars.
  const barHeightsRef = useRef<Animated.Value[]>([]);
  const barOpacitiesRef = useRef<Animated.Value[]>([]);
  while (barHeightsRef.current.length < data.length) {
    barHeightsRef.current.push(new Animated.Value(0));
    barOpacitiesRef.current.push(new Animated.Value(0));
  }
  const barHeights = barHeightsRef.current;
  const barOpacities = barOpacitiesRef.current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const entranceDone = useRef(false);

  // Breathing pulse on the whole container
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  // Normalize a value to 0–1 against the fixed sparkRange
  const normalize = useCallback(
    (val: number) => {
      if (sparkRange) {
        const [lo, hi] = sparkRange;
        return Math.max(0, Math.min(1, (val - lo) / (hi - lo)));
      }
      return 0.5;
    },
    [sparkRange],
  );

  // Entrance: spring bars in one by one
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.parallel(
        data.map((val, i) => {
          const n = normalize(val);
          return Animated.sequence([
            Animated.delay(i * 25),
            Animated.parallel([
              Animated.spring(barHeights[i], { toValue: 4 + n * 18, friction: 4, tension: 140, useNativeDriver: false }),
              Animated.spring(barOpacities[i], { toValue: 0.35 + n * 0.45, friction: 4, tension: 140, useNativeDriver: false }),
            ]),
          ]);
        }),
      ).start(() => {
        entranceDone.current = true;
      });
    }, entranceDelay + 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates: smoothly animate to new heights when data changes
  useEffect(() => {
    if (!entranceDone.current) return;

    data.forEach((val, i) => {
      const n = normalize(val);
      Animated.parallel([
        Animated.timing(barHeights[i], {
          toValue: 4 + n * 18,
          duration: 350,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(barOpacities[i], {
          toValue: 0.35 + n * 0.45,
          duration: 350,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]).start();
    });
  }, [data, barHeights, barOpacities, normalize]);

  // Press bounce
  useEffect(() => {
    if (!active) return;

    barHeights.forEach((anim, i) => {
      const n = normalize(data[i]);
      const target = 4 + n * 18;
      Animated.sequence([
        Animated.delay(i * 30),
        Animated.timing(anim, { toValue: target * 0.1, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.spring(anim, { toValue: target, friction: 3, tension: 200, useNativeDriver: false }),
      ]).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (data.length === 0) return null;

  return (
    <Animated.View style={[sparkStyles.container, { opacity: pulseAnim }]}>
      {Array.from({ length: data.length }, (_, i) => (
        <Animated.View
          key={i}
          style={[sparkStyles.bar, {
            height: barHeights[i],
            backgroundColor: color,
            opacity: barOpacities[i],
          }]}
        />
      ))}
    </Animated.View>
  );
}

const sparkStyles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "flex-end", gap: 3, marginTop: 10, height: 22 },
  bar: { width: 4, borderRadius: 2 },
});

export default function MetricCard({ metric, mode, delay = 0, fullWidth = false }: Props) {
  const isExtreme = mode === "extreme";

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;
  const scaleAnim = useRef(new Animated.Value(0.96)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const pressRotate = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const [sparkActive, setSparkActive] = useState(false);
  const [entranceDone, setEntranceDone] = useState(false);
  const valueAnim = useRef(new Animated.Value(0)).current;
  const [displayValue, setDisplayValue] = useState(0);
  const initialValueRef = useRef(metric.value);

  // Single listener — drives displayValue for both entrance and live updates
  useEffect(() => {
    const id = valueAnim.addListener(({ value }) => setDisplayValue(value));
    return () => valueAnim.removeListener(id);
  }, [valueAnim]);

  // Entrance: fade/slide card in, then count up 0 → initial value
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => {
        Animated.timing(valueAnim, {
          toValue: initialValueRef.current,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start(() => setEntranceDone(true));
      });
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates: smoothly glide to new value
  useEffect(() => {
    if (!entranceDone) return;
    Animated.timing(valueAnim, {
      toValue: metric.value,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [metric.value, entranceDone, valueAnim]);

  const formatNum = (v: number) =>
    metric.precision != null && metric.precision > 0
      ? v.toFixed(metric.precision)
      : String(Math.round(v));

  const formattedValue = formatNum(displayValue);

  const combinedScale = Animated.multiply(scaleAnim, pressScale);
  const rotateInterpolation = pressRotate.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ["-1.5deg", "0deg", "1.5deg"],
  });

  const handlePressIn = useCallback(() => {
    setSparkActive(true);
    Animated.parallel([
      Animated.timing(pressScale, { toValue: 0.96, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pressRotate, { toValue: 1, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(glowOpacity, { toValue: 1, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [pressScale, pressRotate, glowOpacity]);

  const handlePressOut = useCallback(() => {
    setSparkActive(false);
    Animated.parallel([
      Animated.spring(pressScale, { toValue: 1, friction: 5, tension: 200, useNativeDriver: true }),
      Animated.spring(pressRotate, { toValue: 0, friction: 5, tension: 200, useNativeDriver: true }),
      Animated.timing(glowOpacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [pressScale, pressRotate, glowOpacity]);

  const borders = statusBorder[mode];
  const bgs = statusBg[mode];
  const borderColor = borders[metric.status] ?? borders.normal;
  const bgColor = bgs[metric.status] ?? bgs.normal;

  return (
    <Animated.View
      style={[
        styles.card,
        fullWidth && styles.cardFull,
        {
          backgroundColor: bgColor,
          borderColor,
          opacity: fadeAnim,
          transform: [{ translateY }, { scale: combinedScale }, { rotate: rotateInterpolation }],
        },
      ]}
    >
      <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} style={styles.pressable}>
        <Animated.View
          style={[styles.glowBorder, { borderColor: metric.accentColor, opacity: glowOpacity }]}
          pointerEvents="none"
        />

        <Text style={styles.label}>{metric.label}</Text>

        <View style={styles.valueRow}>
          <Text style={[styles.value, metric.placeholder && styles.valuePlaceholder]}>
            {metric.placeholder ? "—" : formattedValue}
          </Text>
          <Text style={styles.unit}>{metric.unit}</Text>
        </View>

        {metric.subtitle && (
          <Text
            style={[
              styles.subtitle,
              metric.status === "critical" && { color: "#F87171" },
              metric.status === "warning" && { color: "#FBBF24" },
            ]}
          >
            {metric.subtitle}
          </Text>
        )}

        <Sparkline data={metric.trend} color={metric.accentColor} active={sparkActive} entranceDelay={delay} sparkRange={metric.sparkRange} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    width: "48%",
    marginBottom: 12,
    overflow: "hidden",
  },
  cardFull: {
    width: "100%",
  },
  pressable: {
    padding: 14,
  },
  glowBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  label: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 6,
  },
  value: {
    color: "#F1F5F9",
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  valuePlaceholder: {
    color: "#475569",
  },
  unit: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "500",
    marginLeft: 4,
  },
  subtitle: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "400",
    marginTop: 3,
  },
});
