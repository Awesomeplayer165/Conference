import { describe, expect, it } from "bun:test";
import {
  createProducerSettings,
  degradationPreferenceForContent,
  selectProducerMaxFps,
} from "./producerPolicy.js";

describe("producer frame-rate policy", () => {
  it("clamps a manual request to the frame rate actually applied to the track", () => {
    expect(
      selectProducerMaxFps({
        requestedFps: 120,
        userEdited: true,
        reportedCapabilityMax: 30,
        trackFrameRate: 60,
      }),
    ).toBe(60);
  });

  it("uses the configured track rate before a capability maximum in automatic mode", () => {
    expect(
      selectProducerMaxFps({
        requestedFps: 120,
        userEdited: false,
        reportedCapabilityMax: 120,
        trackFrameRate: 60,
      }),
    ).toBe(60);
  });
});

describe("degradation preference", () => {
  it("preserves frame cadence for motion and balanced sharing", () => {
    expect(degradationPreferenceForContent("motion")).toBe("maintain-framerate");
    expect(degradationPreferenceForContent("auto")).toBe("maintain-framerate");
  });

  it("also protects cadence for the legacy detail preference", () => {
    expect(degradationPreferenceForContent("detail")).toBe("maintain-framerate");
  });
});

describe("producer settings", () => {
  it("derives a bounded quality floor from the captured geometry", () => {
    expect(
      createProducerSettings({
        width: 3024,
        height: 1890,
        maxFps: 60,
        maxBitrateBps: 50_000_000,
        contentMode: "motion",
      }),
    ).toEqual({
      maxFps: 60,
      maxBitrateBps: 50_000_000,
      minBitrateBps: 12_000_000,
      contentMode: "motion",
      scaleResolutionDownBy: 1,
    });
  });
});
