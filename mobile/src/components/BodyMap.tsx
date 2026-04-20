import { useEffect, useRef } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import type { Metric } from "../data/mockData";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bodyImage = require("../../assets/body_white.png");

type Indicator = {
  metricId: string;
  label: string;
  x: number; // % from left (center of glow)
  y: number; // % from top (center of glow)
  size: number; // glow radius
  side: "left" | "right";
};

// Combined indicator renders HR | HRV in one label
const COMBINED_ID = "heart-rate+hrv";

const INDICATORS: Indicator[] = [
  { metricId: COMBINED_ID, label: "", x: 56, y: 18, size: 44, side: "right" },
  { metricId: "blood-oxygen", label: "SpO\u2082", x: 70, y: 88, size: 36, side: "right" },
  { metricId: "core-temp", label: "Temp", x: 50, y: 50, size: 48, side: "left" },
  { metricId: "sweat", label: "Sweat", x: 36, y: 23, size: 34, side: "left" },
];

const statusColor = {
  normal: "#6EE7B7",
  warning: "#FBBF24",
  critical: "#F87171",
};

const PLACEHOLDER_COLOR = "#475569";

type Props = {
  metrics: Metric[];
};

export default function BodyMap({ metrics }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const zoneAnims = useRef(INDICATORS.map(() => new Animated.Value(0))).current;

  const metricsById = Object.fromEntries(metrics.map((m) => [m.id, m]));

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(() => {
      Animated.stagger(100,
        zoneAnims.map((a) =>
          Animated.spring(a, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
        ),
      ).start();
    });
  }, [fadeAnim, zoneAnims]);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Image source={bodyImage} style={styles.bodyImage} resizeMode="contain" />

      {INDICATORS.map((ind, i) => {
        const isCombined = ind.metricId === COMBINED_ID;
        const hr = isCombined ? metricsById["heart-rate"] : null;
        const hrv = isCombined ? metricsById["hrv"] : null;
        const metric = isCombined ? hr : metricsById[ind.metricId];
        if (!metric) return null;
        const combinedPlaceholder = isCombined && (!!hr?.placeholder || !!hrv?.placeholder);
        const isPlaceholder = isCombined ? combinedPlaceholder : !!metric.placeholder;
        const color = isPlaceholder
          ? PLACEHOLDER_COLOR
          : statusColor[metric.status] ?? statusColor.normal;
        const isLeft = ind.side === "left";
        const glowSize = ind.size;

        return (
          <Animated.View
            key={ind.metricId}
            style={[
              styles.zone,
              {
                left: `${ind.x}%`,
                top: `${ind.y}%`,
                marginLeft: -glowSize / 2,
                marginTop: -glowSize / 2,
                opacity: zoneAnims[i],
                transform: [{ scale: zoneAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
              },
            ]}
          >
            {/* Radial glow area */}
            <View style={[styles.glow, {
              width: glowSize,
              height: glowSize,
              borderRadius: glowSize / 2,
              backgroundColor: color + "12",
              borderColor: color + "1A",
            }]}>
              <View style={[styles.glowInner, {
                width: glowSize * 0.5,
                height: glowSize * 0.5,
                borderRadius: glowSize * 0.25,
                backgroundColor: color + "20",
              }]} />
            </View>

            {/* Label card */}
            <View style={[
              styles.labelCard,
              isLeft ? { right: glowSize / 2 + 30 } : { left: glowSize / 2 + 22 },
            ]}>
              {isCombined && hr && hrv ? (
                <>
                  <Text style={[styles.labelName, { color: hr.placeholder ? PLACEHOLDER_COLOR : color }]} numberOfLines={1}>HR</Text>
                  <Text style={styles.labelValue} numberOfLines={1}>{hr.placeholder ? "\u2014" : hr.value}</Text>
                  <Text style={styles.labelUnit} numberOfLines={1}>{hr.unit}</Text>
                  <Text style={styles.divider}>|</Text>
                  <Text style={[styles.labelName, { color: hrv.placeholder ? PLACEHOLDER_COLOR : (statusColor[hrv.status] ?? color) }]} numberOfLines={1}>HRV</Text>
                  <Text style={styles.labelValue} numberOfLines={1}>{hrv.placeholder ? "\u2014" : hrv.value}</Text>
                  <Text style={styles.labelUnit} numberOfLines={1}>{hrv.unit}</Text>
                </>
              ) : (
                <>
                  <Text style={[styles.labelName, { color }]} numberOfLines={1}>{ind.label}</Text>
                  <Text style={styles.labelValue} numberOfLines={1}>
                    {metric.placeholder
                      ? "\u2014"
                      : metric.precision
                        ? metric.value.toFixed(metric.precision)
                        : metric.value}
                  </Text>
                  <Text style={styles.labelUnit} numberOfLines={1}>{metric.unit}</Text>
                </>
              )}
            </View>
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

const BODY_HEIGHT = 280;
const BODY_WIDTH = 250;

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: BODY_HEIGHT,
    alignSelf: "center",
    marginTop: 24,
    marginBottom: 32,
    overflow: "visible",
  },
  bodyImage: {
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
    alignSelf: "center",
    opacity: 0.16,
  },
  zone: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  glow: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  glowInner: {},
  labelCard: {
    position: "absolute",
    top: "50%",
    marginTop: -10,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
    backgroundColor: "rgba(3,7,18,0.80)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  labelName: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  labelValue: {
    color: "rgba(255,255,255,0.90)",
    fontSize: 12,
    fontWeight: "700",
  },
  labelUnit: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 9,
    fontWeight: "500",
  },
  divider: {
    color: "rgba(255,255,255,0.15)",
    fontSize: 11,
    fontWeight: "300",
    marginHorizontal: 2,
  },
});
