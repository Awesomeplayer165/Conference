import { describe, expect, it } from "bun:test";
import { getScenario, SCENARIOS, scenariosForStage } from "./index.js";

describe("scenario catalog", () => {
  it("includes Stage 4 bitrate staircase decision gate", () => {
    const scenario = getScenario("bitrate-staircase-fixed-geometry");
    expect(scenario?.category).toBe("bitrate-cap");
    expect(scenario?.introducedInStage).toBe(4);
  });

  it("lists Stage 0 as having no executable scenarios yet", () => {
    expect(scenariosForStage(0)).toHaveLength(0);
    expect(SCENARIOS.length).toBeGreaterThan(0);
  });

  it("defines the Stage 3 cross-browser telemetry gate", () => {
    const scenario = getScenario("cross-browser-telemetry-baseline");
    expect(scenario?.introducedInStage).toBe(3);
    expect(scenario?.evidence).toContain("counter and SSRC reset handling");
  });
});
