export type ScenarioCategory =
  | "capture"
  | "connectivity"
  | "telemetry"
  | "bitrate-cap"
  | "loss-recovery"
  | "emergency-scaling"
  | "compatibility";

export interface ScenarioDefinition {
  id: string;
  category: ScenarioCategory;
  introducedInStage: number;
  description: string;
  evidence: readonly string[];
  networkConditioning: "none" | "optional-live" | "synthetic-replay";
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: "capture-arbitrary-native-geometry",
    category: "capture",
    introducedInStage: 1,
    description: "Record the selected surface's actual capabilities and settings.",
    evidence: ["capabilities", "settings", "local render dimensions"],
    networkConditioning: "none",
  },
  {
    id: "cross-browser-h264-pristine",
    category: "connectivity",
    introducedInStage: 2,
    description: "Exercise every Chrome, Firefox, and Safari sender/viewer pairing.",
    evidence: ["negotiated codec", "first frame", "15-minute soak"],
    networkConditioning: "none",
  },
  {
    id: "cross-browser-telemetry-baseline",
    category: "telemetry",
    introducedInStage: 3,
    description:
      "Collect one-second browser/SFU samples, presentation cadence, and latency percentiles for each desktop browser pairing.",
    evidence: [
      "normalized JSONL samples and lifecycle events",
      "source/encoded/decoded/render geometry",
      "capture/encode/decode/presentation FPS",
      "counter and SSRC reset handling",
      "clock-offset and latency percentile report",
    ],
    networkConditioning: "none",
  },
  {
    id: "bitrate-staircase-fixed-geometry",
    category: "bitrate-cap",
    introducedInStage: 4,
    description:
      "Lower bitrate caps while resolution and requested FPS remain fixed; collect browser behavior before controller design.",
    evidence: [
      "encoded resolution and FPS",
      "actual bitrate",
      "QP when available",
      "drops and freezes",
      "perceptual reference comparison",
      "human-inspection notes",
    ],
    networkConditioning: "none",
  },
  {
    id: "capacity-step-controller-replay",
    category: "telemetry",
    introducedInStage: 5,
    description: "Replay deterministic capacity drops, recoveries, and oscillations.",
    evidence: ["decision log", "state transitions", "rejected transitions"],
    networkConditioning: "synthetic-replay",
  },
  {
    id: "loss-and-jitter-recovery",
    category: "loss-recovery",
    introducedInStage: 6,
    description: "Observe RTX, freezes, bounded keyframe requests, and latency recovery.",
    evidence: ["NACK/RTX counters", "freeze timeline", "latency percentiles"],
    networkConditioning: "optional-live",
  },
];

export function getScenario(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

export function scenariosForStage(stage: number): readonly ScenarioDefinition[] {
  return SCENARIOS.filter((scenario) => scenario.introducedInStage === stage);
}
