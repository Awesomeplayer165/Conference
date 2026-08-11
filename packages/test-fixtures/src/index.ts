export interface FixtureSpecification {
  id: string;
  title: string;
  purpose: "detail" | "motion" | "latency" | "perceptual-quality";
  deterministicElements: readonly string[];
  targetFrameRates: readonly number[];
}

export const FIXTURE_SPECIFICATIONS: readonly FixtureSpecification[] = [
  {
    id: "desktop-detail-pattern",
    title: "Desktop detail and edge pattern",
    purpose: "detail",
    deterministicElements: [
      "small text at fixed point sizes",
      "one-pixel lines and grids",
      "flat color regions",
      "high-contrast UI edges",
      "gradients and color patches",
    ],
    targetFrameRates: [15, 30, 60],
  },
  {
    id: "motion-cadence-pattern",
    title: "High-motion cadence pattern",
    purpose: "motion",
    deterministicElements: [
      "constant-speed horizontal motion",
      "constant-speed vertical scrolling",
      "cursor path",
      "full-frame transitions",
    ],
    targetFrameRates: [24, 30, 45, 60, 120],
  },
  {
    id: "frame-identity-clock",
    title: "Frame identity and latency marker",
    purpose: "latency",
    deterministicElements: [
      "monotonic frame sequence",
      "monotonic source timestamp",
      "high-contrast machine-readable blocks",
    ],
    targetFrameRates: [30, 60, 120],
  },
  {
    id: "bitrate-quality-reference",
    title: "Perceptual bitrate quality reference",
    purpose: "perceptual-quality",
    deterministicElements: [
      "fixed reference frames",
      "repeatable motion cycle",
      "human-inspection annotation points",
      "full-resolution frame capture checkpoints",
    ],
    targetFrameRates: [30, 60],
  },
];

export function fixtureById(id: string): FixtureSpecification | undefined {
  return FIXTURE_SPECIFICATIONS.find((fixture) => fixture.id === id);
}
