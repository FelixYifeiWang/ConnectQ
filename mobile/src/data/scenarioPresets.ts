import type { AppMode, ExpeditionInfo } from "./mockData";

export type Stamp = {
  mountain: string;
  altitude: number;
  subtitle?: string;
  date?: string;
  region?: string;
};

export type FeedbackItem = { label: string; status: "good" | "improve"; detail: string; score: number };

export type JourneyStage = { label: string; status: "done" | "current" | "locked" };

export type OnboardingSection = {
  header: string;
  items: { label: string; value: string; selected?: boolean }[];
};

export type Interstitial =
  | { variant: "stamps"; stamps: Stamp[]; title?: string; subtitle?: string; locked?: Stamp[] }
  | { variant: "feedback"; title: string; heroScore: number; heroLabel: string; items: FeedbackItem[]; summary: string; recommendation?: string }
  | { variant: "journey"; title: string; subtitle: string; stages: JourneyStage[]; badge: string; insight: string }
  | { variant: "onboarding"; title: string; sections: OnboardingSection[]; assessment: string; insight: string };

export type ScenarioPreset = {
  id: string;
  label: string;
  metricBaselines: Record<string, number>;
  expedition: Partial<ExpeditionInfo>;
  lockedMode?: AppMode;
  interstitial?: Interstitial;
  bodyMap?: boolean;
  // Live preset renders real sensor data from the Arduino instead of the
  // scripted simulation. Daily/Extreme toggle stays user-switchable.
  live?: boolean;
};

// ── Progression peaks ──

const RAINIER_EXPEDITION: Partial<ExpeditionInfo> = {
  name: "Rainier Summit Climb",
  mountain: "Mt. Rainier",
  campName: "Camp Muir \u2014 3,100m",
  currentAltitude: 4200,
  targetAltitude: 4392,
  baseAltitude: 1600,
  day: 2,
  totalDays: 3,
  weatherCondition: "Clear Skies",
  windDirection: "SW 20 km/h",
  sunrise: "05:22",
  sunset: "20:45",
};

// ── Training mountains ──

const ISLAND_PEAK_EXPEDITION: Partial<ExpeditionInfo> = {
  name: "Island Peak Expedition",
  mountain: "Island Peak",
  campName: "High Camp \u2014 6,000m",
  currentAltitude: 6100,
  targetAltitude: 6189,
  baseAltitude: 5100,
  day: 8,
  totalDays: 14,
  weatherCondition: "Clear Skies",
  windDirection: "W 15 km/h",
  sunrise: "05:48",
  sunset: "17:55",
};

const CHO_OYU_EXPEDITION: Partial<ExpeditionInfo> = {
  name: "Cho Oyu Expedition",
  mountain: "Cho Oyu",
  campName: "Camp III \u2014 Summit Push",
  currentAltitude: 8100,
  targetAltitude: 8188,
  baseAltitude: 5700,
  day: 18,
  totalDays: 28,
  weatherCondition: "High Winds",
  windDirection: "NW 55 km/h",
  sunrise: "06:02",
  sunset: "17:38",
};

// ── Everest expedition ──

const EVEREST_BASE: Partial<ExpeditionInfo> = {
  name: "Everest North Ridge",
  mountain: "Mt. Everest",
  targetAltitude: 8849,
  totalDays: 42,
  sunrise: "06:12",
  sunset: "18:47",
};

// ── Stamps: full climbing career ──

// Intro phase
const STAMP_WHITNEY: Stamp = { mountain: "Mt. Whitney", altitude: 4421, subtitle: "First 14er", date: "Jun 2022", region: "California" };
const STAMP_ELBERT: Stamp = { mountain: "Mt. Elbert", altitude: 4401, subtitle: "Colorado high point", date: "Aug 2022", region: "Colorado" };

// Training phase
const STAMP_SHASTA: Stamp = { mountain: "Mt. Shasta", altitude: 4322, subtitle: "First glacier", date: "Feb 2023", region: "California" };
const STAMP_BAKER: Stamp = { mountain: "Mt. Baker", altitude: 3286, subtitle: "First whiteout", date: "May 2023", region: "Washington" };
const STAMP_RAINIER: Stamp = { mountain: "Mt. Rainier", altitude: 4392, subtitle: "First guided summit", date: "Jul 2023", region: "Washington" };

// International progression
const STAMP_COTOPAXI: Stamp = { mountain: "Cotopaxi", altitude: 5897, subtitle: "First 5,000er", date: "Nov 2023", region: "Ecuador" };
const STAMP_KILIMANJARO: Stamp = { mountain: "Kilimanjaro", altitude: 5895, subtitle: "Roof of Africa", date: "Mar 2024", region: "Tanzania" };

// High altitude
const STAMP_ISLAND_PEAK: Stamp = { mountain: "Island Peak", altitude: 6189, subtitle: "First 6,000er", date: "Oct 2024", region: "Nepal" };
const STAMP_CHO_OYU: Stamp = { mountain: "Cho Oyu", altitude: 8188, subtitle: "8,000m audition", date: "Sep 2025", region: "Tibet" };

// Aspirational
const STAMP_EVEREST: Stamp = { mountain: "Mt. Everest", altitude: 8849, region: "Nepal" };
const STAMP_K2: Stamp = { mountain: "K2", altitude: 8611, region: "Pakistan" };
const STAMP_DENALI: Stamp = { mountain: "Denali", altitude: 6190, region: "Alaska" };

// ── Presets ──

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  // 0 — LIVE: real sensor data from the Arduino
  {
    id: "live",
    label: "LIVE",
    live: true,
    bodyMap: true,
    metricBaselines: {},
    expedition: {
      name: "Live Session",
      mountain: "Live Session",
      campName: "\u2014",
      currentAltitude: 0,
      targetAltitude: 0,
      baseAltitude: 0,
      day: 1,
      totalDays: 1,
      weatherCondition: "\u2014",
      windDirection: "\u2014",
      sunrise: "\u2014",
      sunset: "\u2014",
    },
  },

  // 1 — Onboarding questionnaire
  {
    id: "onboarding",
    label: "",
    metricBaselines: {},
    expedition: {},
    interstitial: {
      variant: "onboarding",
      title: "LET\u2019S GET TO KNOW YOU",
      sections: [
        {
          header: "EXPERIENCE",
          items: [
            { label: "Level", value: "Beginner", selected: true },
            { label: "Highest summit", value: "Mt. Whitney, 4,421m" },
            { label: "Technical training", value: "None yet" },
          ],
        },
        {
          header: "FITNESS",
          items: [
            { label: "Cardio", value: "30+ mi/week", selected: true },
            { label: "Strength", value: "3x/week" },
            { label: "Cold exposure", value: "Limited" },
          ],
        },
        {
          header: "GOAL",
          items: [
            { label: "Target", value: "Mt. Everest", selected: true },
            { label: "Timeline", value: "4\u20135 years" },
          ],
        },
      ],
      assessment: "LEVEL 1 \u2014 BEGINNER",
      insight: "Strong aerobic base. You need altitude and technical exposure.",
    },
  },

  // 1 — Journey roadmap
  {
    id: "journey",
    label: "",
    metricBaselines: {},
    expedition: {},
    interstitial: {
      variant: "journey",
      title: "EVEREST",
      subtitle: "8,849m \u2022 The highest point on Earth",
      stages: [
        { label: "Day Hikes & Fitness Base", status: "current" },
        { label: "Altitude Gym Training", status: "locked" },
        { label: "Mountaineering Course", status: "locked" },
        { label: "Island Peak (6,189m)", status: "locked" },
        { label: "Cho Oyu (8,188m)", status: "locked" },
        { label: "Everest Expedition", status: "locked" },
      ],
      badge: "LEVEL 1 \u2014 BEGINNER",
      insight: "Every summit starts with a single step",
    },
  },

  // 1 — Intro: Day hike
  {
    id: "day-hike",
    label: "Day Hike",
    lockedMode: "daily",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 68,
      "blood-oxygen": 98,
      "hrv": 55,
      "core-temp": 37.1,
      "skin-temp": 30,
      "altitude": 2400,
      "air-pressure": 760,
      "ambient-temp": 12,
      "cadence": 58,
      "ascent-rate": 160,
    },
    expedition: {
      name: "Weekend Hike",
      mountain: "Mt. Whitney Trail",
      campName: "Trail \u2014 Lone Pine Creek",
      currentAltitude: 2400,
      targetAltitude: 4421,
      baseAltitude: 2550,
      day: 1,
      totalDays: 1,
      weatherCondition: "Sunny",
      windDirection: "W 8 km/h",
      sunrise: "06:05",
      sunset: "19:32",
    },
  },

  // 2 — Intro: Assessment
  {
    id: "intro-assessment",
    label: "",
    metricBaselines: {},
    expedition: {},
    interstitial: {
      variant: "feedback",
      title: "WHERE YOU STAND",
      heroScore: 42,
      heroLabel: "READINESS",
      items: [
        { label: "Cardio Base", status: "good", detail: "30+ mi/week puts you ahead of most beginners", score: 88 },
        { label: "Trail Experience", status: "good", detail: "You know how to suffer uphill", score: 72 },
        { label: "Altitude Exposure", status: "improve", detail: "Next step: train above 4,500m", score: 15 },
        { label: "Technical Skills", status: "improve", detail: "Next step: crampon & rope course", score: 8 },
        { label: "Cold Tolerance", status: "improve", detail: "Next step: sub-zero overnight", score: 22 },
      ],
      summary: "2 of 5 foundations in place",
      recommendation: "Enroll in a mountaineering course \u2014 NOLS, RMI, or AAI",
    },
  },

  // 3 — High-altitude gym
  {
    id: "altitude-gym",
    label: "Altitude Gym",
    lockedMode: "daily",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 145,
      "blood-oxygen": 88,
      "hrv": 22,
      "core-temp": 37.4,
      "skin-temp": 33,
      "altitude": 4500,
      "air-pressure": 580,
      "ambient-temp": 18,
      "cadence": 72,
      "ascent-rate": 0,
    },
    expedition: {
      name: "Altitude Training",
      mountain: "Hypoxico Gym",
      campName: "Simulated 4,500m",
      currentAltitude: 4500,
      targetAltitude: 5500,
      baseAltitude: 0,
      day: 1,
      totalDays: 1,
      weatherCondition: "Indoor",
      windDirection: "\u2014",
      sunrise: "\u2014",
      sunset: "\u2014",
    },
  },

  // 1 — Gym feedback
  {
    id: "gym-feedback",
    label: "",
    metricBaselines: {},
    expedition: {},
    interstitial: {
      variant: "feedback",
      title: "SESSION REVIEW",
      heroScore: 78,
      heroLabel: "SESSION SCORE",
      items: [
        { label: "SpO\u2082 Recovery", status: "good", detail: "96% within 90s \u2014 faster than last week", score: 91 },
        { label: "Heart Rate Control", status: "good", detail: "Zone 3 held for 18 min under hypoxia", score: 85 },
        { label: "HRV Baseline", status: "improve", detail: "38ms \u2014 below 45ms target. Sleep debt?", score: 52 },
        { label: "Breathing Pattern", status: "good", detail: "3:2 rhythm steady at 4,500m sim", score: 88 },
        { label: "Lactate Tolerance", status: "improve", detail: "Pace dropped 15% above 4,200m sim", score: 58 },
      ],
      summary: "3 of 5 metrics on track",
      recommendation: "Prioritize 8hr sleep before next altitude session",
    },
  },

  // 2 — Training: Mt. Rainier
  {
    id: "rainier",
    label: "Mt. Rainier",
    lockedMode: "daily",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 75,
      "blood-oxygen": 94,
      "hrv": 48,
      "core-temp": 37.0,
      "skin-temp": 29,
      "altitude": 4200,
      "air-pressure": 610,
      "ambient-temp": -5,
      "cadence": 50,
      "ascent-rate": 100,
    },
    expedition: RAINIER_EXPEDITION,
  },

  // 1 — Training report
  {
    id: "training-report",
    label: "",
    metricBaselines: {},
    expedition: {},
    interstitial: {
      variant: "feedback",
      title: "TRAINING COMPLETE",
      heroScore: 95,
      heroLabel: "READINESS",
      items: [
        { label: "Crampons & Ice Axe", status: "good", detail: "Confident on 40\u00b0 ice at Disappointment Cleaver", score: 94 },
        { label: "Rope Skills", status: "good", detail: "Led a rope team across Cowlitz Glacier", score: 91 },
        { label: "Crevasse Rescue", status: "good", detail: "Self-arrest in 6s, Z-pulley in 8 min", score: 97 },
        { label: "Turnaround Discipline", status: "good", detail: "Turned back at Baker 200m from summit in whiteout", score: 98 },
        { label: "Peak Progression", status: "good", detail: "3 summits in 14 months \u2014 Shasta, Baker, Rainier", score: 92 },
      ],
      summary: "All 5 skills certified",
      recommendation: "You\u2019re cleared for 6,000m+ expeditions",
    },
  },

  // 2 — High altitude: Island Peak
  {
    id: "island-peak",
    label: "Island Peak",
    lockedMode: "extreme",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 82,
      "blood-oxygen": 90,
      "hrv": 42,
      "core-temp": 36.8,
      "skin-temp": 27,
      "altitude": 6100,
      "air-pressure": 470,
      "ambient-temp": -15,
      "cadence": 38,
      "ascent-rate": 80,
    },
    expedition: ISLAND_PEAK_EXPEDITION,
  },

  // 1 — Stamp wall: Island Peak summited
  {
    id: "stamp-island-peak",
    label: "",
    metricBaselines: {},
    expedition: {},
    interstitial: {
      variant: "stamps",
      stamps: [STAMP_WHITNEY, STAMP_ELBERT, STAMP_SHASTA, STAMP_BAKER, STAMP_RAINIER, STAMP_COTOPAXI, STAMP_KILIMANJARO, STAMP_ISLAND_PEAK],
      title: "SUMMIT LOG",
      locked: [STAMP_CHO_OYU, STAMP_EVEREST, STAMP_DENALI, STAMP_K2],
    },
  },

  // 2 — Training: Cho Oyu
  {
    id: "cho-oyu",
    label: "Cho Oyu",
    lockedMode: "extreme",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 120,
      "blood-oxygen": 72,
      "hrv": 16,
      "core-temp": 35.9,
      "skin-temp": 22,
      "altitude": 8100,
      "air-pressure": 356,
      "ambient-temp": -35,
      "cadence": 22,
      "ascent-rate": 45,
    },
    expedition: CHO_OYU_EXPEDITION,
  },

  // 3 — Stamp wall: Cho Oyu summited + Everest Qualified
  {
    id: "stamp-everest-qualified",
    label: "",
    metricBaselines: {},
    expedition: {},
    interstitial: {
      variant: "stamps",
      stamps: [STAMP_WHITNEY, STAMP_ELBERT, STAMP_SHASTA, STAMP_BAKER, STAMP_RAINIER, STAMP_COTOPAXI, STAMP_KILIMANJARO, STAMP_ISLAND_PEAK, STAMP_CHO_OYU],
      title: "EVEREST QUALIFIED",
      subtitle: "You\u2019re ready for the mountain",
      locked: [STAMP_EVEREST, STAMP_DENALI, STAMP_K2],
    },
  },

  // 4 — Everest: Trek to Base Camp
  {
    id: "trek-in",
    label: "Trek to Base Camp",
    lockedMode: "daily",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 68,
      "blood-oxygen": 97,
      "hrv": 58,
      "core-temp": 37.1,
      "skin-temp": 31,
      "altitude": 3500,
      "air-pressure": 660,
      "ambient-temp": 5,
      "cadence": 62,
      "ascent-rate": 150,
    },
    expedition: {
      ...EVEREST_BASE,
      campName: "Trek \u2014 Namche Bazaar",
      currentAltitude: 3500,
      baseAltitude: 2860,
      day: 4,
      weatherCondition: "Clear Skies",
      windDirection: "SW 8 km/h",
    },
  },

  // 5 — Everest: Base Camp
  {
    id: "base-camp",
    label: "Base Camp",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 72,
      "blood-oxygen": 95,
      "hrv": 52,
      "core-temp": 37.0,
      "skin-temp": 32,
      "altitude": 5150,
      "air-pressure": 540,
      "ambient-temp": -8,
      "cadence": 55,
      "ascent-rate": 120,
    },
    expedition: {
      ...EVEREST_BASE,
      campName: "Base Camp \u2014 South Col",
      currentAltitude: 5150,
      baseAltitude: 5150,
      day: 12,
      weatherCondition: "Clear Skies",
      windDirection: "W 12 km/h",
    },
  },

  // 6 — Everest: Acclimatization
  {
    id: "acclimatization",
    label: "Acclimatization",
    lockedMode: "extreme",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 88,
      "blood-oxygen": 88,
      "hrv": 35,
      "core-temp": 36.6,
      "skin-temp": 29,
      "altitude": 6400,
      "air-pressure": 460,
      "ambient-temp": -18,
      "cadence": 45,
      "ascent-rate": 95,
    },
    expedition: {
      ...EVEREST_BASE,
      campName: "Camp II \u2014 Western Cwm",
      currentAltitude: 6400,
      baseAltitude: 5150,
      day: 22,
      weatherCondition: "Partly Cloudy",
      windDirection: "NW 28 km/h",
    },
  },

  // 7 — Everest: South Col
  {
    id: "south-col",
    label: "South Col",
    lockedMode: "extreme",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 110,
      "blood-oxygen": 76,
      "hrv": 20,
      "core-temp": 36.1,
      "skin-temp": 25,
      "altitude": 7800,
      "air-pressure": 380,
      "ambient-temp": -30,
      "cadence": 30,
      "ascent-rate": 60,
    },
    expedition: {
      ...EVEREST_BASE,
      campName: "Camp IV \u2014 South Col",
      currentAltitude: 7800,
      baseAltitude: 5150,
      day: 34,
      weatherCondition: "High Winds",
      windDirection: "NW 65 km/h",
    },
  },

  // 8 — Everest: Summit Push
  {
    id: "summit-push",
    label: "Summit Push",
    lockedMode: "extreme",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 140,
      "blood-oxygen": 68,
      "hrv": 14,
      "core-temp": 35.5,
      "skin-temp": 21,
      "altitude": 8600,
      "air-pressure": 330,
      "ambient-temp": -42,
      "cadence": 18,
      "ascent-rate": 35,
    },
    expedition: {
      ...EVEREST_BASE,
      campName: "Summit Ridge",
      currentAltitude: 8600,
      baseAltitude: 5150,
      day: 35,
      weatherCondition: "Extreme Wind",
      windDirection: "NW 95 km/h",
    },
  },

  // 9 — Everest: Emergency Descent
  {
    id: "emergency-descent",
    label: "Emergency Descent",
    lockedMode: "extreme",
    bodyMap: true,
    metricBaselines: {
      "heart-rate": 130,
      "blood-oxygen": 74,
      "hrv": 18,
      "core-temp": 35.8,
      "skin-temp": 23,
      "altitude": 7000,
      "air-pressure": 410,
      "ambient-temp": -26,
      "cadence": 50,
      "ascent-rate": -180,
    },
    expedition: {
      ...EVEREST_BASE,
      campName: "Emergency Descent",
      currentAltitude: 7000,
      baseAltitude: 5150,
      day: 35,
      weatherCondition: "Deteriorating",
      windDirection: "N 72 km/h",
    },
  },
];
