import { describe, expect, it } from "bun:test";
import {
  createProducerEncoding,
  createProducerSettings,
  degradationPreferenceForContent,
  selectProducerMaxFps,
} from "./producerPolicy.js";

describe("producer encoding", () => {
  it("does not request a scalability mode that can disqualify a hardware encoder", () => {
    expect(
      createProducerEncoding({
        maxBitrateBps: 80_000_000,
        maxFps: 120,
        scaleResolutionDownBy: 1.25,
      }),
    ).toEqual({
      maxBitrate: 80_000_000,
      maxFramerate: 120,
      networkPriority: "high",
      priority: "high",
      scaleResolutionDownBy: 1.25,
    });
  });
});

describe("producer frame-rate policy", () => {
  it("keeps a manual request above a conservative track report", () => {
    expect(
      selectProducerMaxFps({
        requestedFps: 120,
        userEdited: true,
        reportedCapabilityMax: 30,
        trackFrameRate: 60,
      }),
    ).toBe(120);
  });

  it("keeps the configured ceiling in automatic mode so capture can recover", () => {
    expect(
      selectProducerMaxFps({
        requestedFps: 120,
        userEdited: false,
        reportedCapabilityMax: 120,
        trackFrameRate: 60,
      }),
    ).toBe(120);
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
