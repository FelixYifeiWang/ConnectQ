import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AlertCard from "../components/AlertCard";
import BodyMap from "../components/BodyMap";
import ExpeditionHero from "../components/ExpeditionHero";
import JourneyMap from "../components/JourneyMap";
import MetricCard from "../components/MetricCard";
import Onboarding from "../components/Onboarding";
import SectionHeader from "../components/SectionHeader";
import SessionFeedback from "../components/SessionFeedback";
import StampWall from "../components/StampWall";
import { BOARD_HOST } from "../config";
import { type AppMode, type Metric } from "../data/mockData";
import { useScenarioSwipe } from "../hooks/useScenarioSwipe";
import { useSimulatedData } from "../hooks/useSimulatedData";
import { useLiveData, type LiveConnection } from "../hooks/useLiveData";

function formatTime(): string {
  return new Date().toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

type SectionDef = { key: string; title: string; items: Metric[] };

function buildSections(mode: AppMode, allMetrics: Metric[]): SectionDef[] {
  const filtered = allMetrics.filter((m) => m.modes.includes(mode));
  const groups: Record<string, { title: string; items: Metric[] }> = {};
  const titles: Record<string, string> = {
    vitals: "Vitals",
    body: "Body",
  };
  const order = ["vitals", "body"];
  for (const m of filtered) {
    if (!groups[m.section]) groups[m.section] = { title: titles[m.section], items: [] };
    groups[m.section].items.push(m);
  }
  return order.filter((k) => groups[k]?.items.length).map((k) => ({ key: k, ...groups[k] }));
}

const connectionStyle: Record<LiveConnection, { dot: string; label: string; text: string }> = {
  connected:    { dot: "#6EE7B7", label: "LIVE",    text: "#6EE7B7" },
  connecting:   { dot: "#FBBF24", label: "LINKING", text: "#FBBF24" },
  disconnected: { dot: "#57534E", label: "OFFLINE", text: "#78716C" },
  error:        { dot: "#F87171", label: "ERROR",   text: "#F87171" },
};

function ConnectionChip({ connection }: { connection: LiveConnection }) {
  const s = connectionStyle[connection];
  return (
    <View style={styles.chip}>
      <View style={[styles.chipDot, { backgroundColor: s.dot }]} />
      <Text style={[styles.chipLabel, { color: s.text }]}>{s.label}</Text>
    </View>
  );
}

const theme = {
  extreme: {
    bg: "#0C0A09",
    accent: "#FBBF24",
    thumbBg: "rgba(251,191,36,0.12)",
    thumbBorder: "rgba(251,191,36,0.25)",
    titleColor: "#FAFAF9",
    timeColor: "#78716C",
  },
  daily: {
    bg: "#030712",
    accent: "#5B8DEF",
    thumbBg: "rgba(91,141,239,0.10)",
    thumbBorder: "rgba(91,141,239,0.22)",
    titleColor: "#E5E7EB",
    timeColor: "#6B7280",
  },
};

export default function DashboardScreen() {
  const { scenarioIndex, currentPreset, panHandlers } = useScenarioSwipe();
  const sim = useSimulatedData(currentPreset);
  const live = useLiveData(BOARD_HOST);
  const isLive = !!currentPreset.live;
  const metrics = isLive ? live.metrics : sim.metrics;
  const expedition = isLive ? live.expedition : sim.expedition;
  const extremeAlerts = isLive ? live.extremeAlerts : sim.extremeAlerts;
  const dailyAlerts = isLive ? live.dailyAlerts : sim.dailyAlerts;
  const [mode, setMode] = useState<AppMode>("daily");
  const [transitioning, setTransitioning] = useState(false);
  const [time, setTime] = useState(formatTime);
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const toggleSlide = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const loadingOpacity = useRef(new Animated.Value(0)).current;
  const loadingDotAnim = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const overlayScale = useRef(new Animated.Value(0.85)).current;
  const [overlayLabel, setOverlayLabel] = useState("");
  const prevScenarioRef = useRef(scenarioIndex);
  const modeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setTime(formatTime()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    Animated.timing(headerOpacity, {
      toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [headerOpacity]);

  // Single coordinated effect for scenario changes: overlay + mode lock
  useEffect(() => {
    if (prevScenarioRef.current === scenarioIndex) return;
    prevScenarioRef.current = scenarioIndex;

    // Clean up any in-flight mode transition
    if (modeTimerRef.current) {
      clearTimeout(modeTimerRef.current);
      modeTimerRef.current = null;
    }
    setTransitioning(false);
    loadingOpacity.setValue(0);
    contentOpacity.setValue(1);

    // Show overlay for non-interstitial presets (interstitials render their own UI)
    if (!currentPreset.interstitial) {
      setOverlayLabel(currentPreset.label);
      overlayScale.setValue(0.85);
      Animated.sequence([
        Animated.parallel([
          Animated.timing(overlayOpacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(overlayScale, { toValue: 1, friction: 8, tension: 120, useNativeDriver: true }),
        ]),
        Animated.delay(800),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 500, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }

    // Handle mode lock — set mode immediately so theme colors update in sync
    const locked = currentPreset.lockedMode;
    if (locked && locked !== mode) {
      setMode(locked);
      Animated.spring(toggleSlide, {
        toValue: locked === "extreme" ? 1 : 0, friction: 8, tension: 120, useNativeDriver: false,
      }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioIndex]);

  const handleMode = useCallback((newMode: AppMode) => {
    if (newMode === mode || transitioning) return;
    if (currentPreset.lockedMode) return;

    Animated.spring(toggleSlide, {
      toValue: newMode === "extreme" ? 1 : 0,
      friction: 8, tension: 120, useNativeDriver: false,
    }).start();

    if (newMode === "extreme") {
      setTransitioning(true);

      const dotLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(loadingDotAnim, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(loadingDotAnim, { toValue: 0.3, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );

      dotLoop.start();
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 0, duration: 350, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(loadingOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      ]).start(() => { setMode(newMode); });

      modeTimerRef.current = setTimeout(() => {
        modeTimerRef.current = null;
        dotLoop.stop();
        Animated.parallel([
          Animated.timing(loadingOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.timing(contentOpacity, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]).start(() => { setTransitioning(false); });
      }, 1400);
    } else {
      Animated.timing(contentOpacity, {
        toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }).start(() => {
        setMode(newMode);
        Animated.timing(contentOpacity, {
          toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }).start();
      });
    }
  }, [mode, transitioning, toggleSlide, contentOpacity, loadingOpacity, loadingDotAnim, currentPreset.lockedMode]);

  const scrollFade = scrollY.interpolate({ inputRange: [0, 100], outputRange: [1, 0.2], extrapolate: "clamp" });
  const combined = Animated.multiply(headerOpacity, scrollFade);

  const t = theme[mode];
  const alerts = mode === "extreme" ? extremeAlerts : dailyAlerts;
  const sections = buildSections(mode, metrics);

  const toggleLeft = toggleSlide.interpolate({ inputRange: [0, 1], outputRange: ["2%", "50%"] });

  const toggleTarget = transitioning ? "extreme" : mode;
  const tt = theme[toggleTarget];

  let d = mode === "extreme" ? 400 : 80;

  // Interstitial: full-screen, no dashboard
  if (currentPreset.interstitial) {
    const inter = currentPreset.interstitial;
    let content: React.ReactNode;
    if (inter.variant === "onboarding") {
      content = <Onboarding key={currentPreset.id} title={inter.title} sections={inter.sections} assessment={inter.assessment} insight={inter.insight} />;
    } else if (inter.variant === "journey") {
      content = <JourneyMap key={currentPreset.id} title={inter.title} subtitle={inter.subtitle} stages={inter.stages} badge={inter.badge} insight={inter.insight} />;
    } else if (inter.variant === "feedback") {
      content = <SessionFeedback key={currentPreset.id} title={inter.title} heroScore={inter.heroScore} heroLabel={inter.heroLabel} items={inter.items} summary={inter.summary} recommendation={inter.recommendation} />;
    } else {
      content = <StampWall key={currentPreset.id} stamps={inter.stamps} title={inter.title} subtitle={inter.subtitle} locked={inter.locked} />;
    }
    return (
      <View style={styles.root} {...panHandlers}>
        {content}
      </View>
    );
  }

  return (
  <View style={styles.root} {...panHandlers}>
    <Animated.ScrollView
      style={[styles.scroll, { backgroundColor: t.bg }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={Animated.event(
        [{ nativeEvent: { contentOffset: { y: scrollY } } }],
        { useNativeDriver: true }
      )}
    >
      {/* Header */}
      <Animated.View style={{ opacity: combined }}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: t.titleColor }]}>SIXTH</Text>
          <View style={styles.headerRight}>
            {isLive && <ConnectionChip connection={live.connection} />}
            <Text style={[styles.time, { color: t.timeColor }]}>{time}</Text>
          </View>
        </View>
      </Animated.View>

      {/* Toggle */}
      <View style={styles.toggleWrap}>
        <Animated.View style={[styles.thumb, { left: toggleLeft, backgroundColor: tt.thumbBg, borderColor: tt.thumbBorder }]} />
        <Pressable style={styles.toggleBtn} onPress={() => handleMode("daily")} disabled={transitioning || !!currentPreset.lockedMode}>
          <Text style={[
            styles.toggleLabel,
            currentPreset.lockedMode === "extreme" ? styles.toggleDisabled : (mode === "daily" && !transitioning) && { color: theme.daily.accent },
          ]}>Daily</Text>
        </Pressable>
        <Pressable style={styles.toggleBtn} onPress={() => handleMode("extreme")} disabled={transitioning || !!currentPreset.lockedMode}>
          <Text style={[
            styles.toggleLabel,
            currentPreset.lockedMode === "daily" ? styles.toggleDisabled : (mode === "extreme" || transitioning) && { color: theme.extreme.accent },
          ]}>Extreme</Text>
        </Pressable>
      </View>

      {/* Content */}
      <Animated.View style={{ opacity: contentOpacity }}>
        {currentPreset.bodyMap && <BodyMap metrics={metrics} />}
        {mode === "extreme" && <ExpeditionHero expedition={expedition} delay={80} />}

        {alerts.map((a, i) => <AlertCard key={a.id} alert={a} delay={d + i * 40} />)}

        {sections.map((section) => {
          d += 60;
          const base = d + 50;
          d = base + section.items.length * 50;
          const odd = section.items.length % 2 !== 0;

          return (
            <View key={section.key}>
              <SectionHeader title={section.title} mode={mode} delay={d - section.items.length * 50} />
              <View style={styles.grid}>
                {section.items.map((m, i) => (
                  <MetricCard
                    key={m.id}
                    metric={m}
                    mode={mode}
                    delay={base + i * 50}
                    fullWidth={odd && i === section.items.length - 1}
                  />
                ))}
              </View>
            </View>
          );
        })}

        <View style={styles.spacer} />
      </Animated.View>
    </Animated.ScrollView>

    {/* Loading overlay */}
    {transitioning && (
      <Animated.View style={[styles.loadingOverlay, { opacity: loadingOpacity }]} pointerEvents="none">
        <Animated.View style={[styles.loadingDot, { opacity: loadingDotAnim }]} />
        <Text style={styles.loadingText}>Initializing sensors</Text>
      </Animated.View>
    )}

    {/* Scenario change overlay */}
    <Animated.View
      style={[styles.scenarioOverlay, { opacity: overlayOpacity }]}
      pointerEvents="none"
    >
      <Animated.Text
        style={[styles.scenarioOverlayText, { color: t.accent, transform: [{ scale: overlayScale }] }]}
      >
        {overlayLabel}
      </Animated.Text>
    </Animated.View>
  </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.5 },
  time: { fontSize: 11, fontWeight: "500" },
  chip: { flexDirection: "row", alignItems: "center", gap: 5 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  toggleWrap: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3, marginBottom: 12 },
  toggleDisabled: { color: "#1A1A1A" },
  thumb: { position: "absolute", top: 3, bottom: 3, width: "48%", borderRadius: 8, borderWidth: 1 },
  toggleBtn: { flex: 1, alignItems: "center", paddingVertical: 7 },
  toggleLabel: { color: "#57534E", fontSize: 13, fontWeight: "600" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FBBF24",
  },
  loadingText: {
    color: "#78716C",
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.5,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  spacer: { height: 50 },
  scenarioOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  scenarioOverlayText: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
});
