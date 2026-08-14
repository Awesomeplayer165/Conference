import { describe, expect, it } from "bun:test";
import { createEmptyStatisticsSummary } from "@conference/protocol";
import { BalancedMediaController } from "./balancedController.js";

const settings = {
  automaticBitrate: true,
  fallbackCodec: "video/H264" as const,
  maxBitrateBps: 40_000_000,
  maxFps: 60,
  scaleResolutionDownBy: 1,
};

describe("balanced media controller", () => {
  it("reduces resolution after sustained cadence pressure", () => {
    const controller = new BalancedMediaController();
    const sample = {
      ...createEmptyStatisticsSummary(),
      codec: "video/AV1",
      captureFps: 60,
      previewFps: 60,
      encodeFps: 25,
      encodeTimeMsPerFrame: 32,
      qualityLimitationReason: "cpu",
      mediaFlowState: "flowing",
    };
    expect(controller.observe(sample, settings).type).toBe("none");
    expect(controller.observe(sample, settings)).toMatchObject({
      type: "scale",
      scaleResolutionDownBy: 1.5,
    });
  });

  it("switches software AV1 to a known fallback without walking every scale", () => {
    const controller = new BalancedMediaController();
    const sample = {
      ...createEmptyStatisticsSummary(),
      codec: "video/AV1",
      previewFps: 60,
      encodeFps: 20,
      encodeTimeMsPerFrame: 35,
      qualityLimitationReason: "cpu",
      encoderImplementation: "libaom",
      mediaFlowState: "flowing",
    };
    controller.observe(sample, settings);
    expect(controller.observe(sample, settings)).toMatchObject({
      type: "codec",
      codec: "video/H264",
    });
  });

  it("restarts a connected sender after three stalled samples", () => {
    const controller = new BalancedMediaController();
    const sample = {
      ...createEmptyStatisticsSummary(),
      mediaFlowState: "stalled",
      transportState: "connected",
    };
    controller.observe(sample, settings);
    controller.observe(sample, settings);
    expect(controller.observe(sample, settings).type).toBe("restart");
  });

  it("restores detail only after a long stable window", () => {
    const controller = new BalancedMediaController();
    const scaled = { ...settings, scaleResolutionDownBy: 1.5 };
    const sample = {
      ...createEmptyStatisticsSummary(),
      captureFps: 60,
      previewFps: 60,
      encodeFps: 60,
      encodeTimeMsPerFrame: 4,
      qualityLimitationReason: "none",
      mediaFlowState: "flowing",
    };
    for (let index = 0; index < 19; index += 1) {
      expect(controller.observe(sample, scaled).type).toBe("none");
    }
    expect(controller.observe(sample, scaled)).toMatchObject({
      type: "scale",
      scaleResolutionDownBy: 1.25,
    });
  });

  it("expands an automatic ceiling when both sides show sustained headroom", () => {
    const controller = new BalancedMediaController();
    const bandwidthSettings = { ...settings, maxBitrateBps: 40_000_000 };
    const sample = {
      ...createEmptyStatisticsSummary(),
      captureFps: 60,
      encodeFps: 60,
      encodeTimeMsPerFrame: 4,
      qualityLimitationReason: "none",
      encoderTargetBitrateBps: 38_000_000,
      availableOutgoingBitrateBps: 40_000_000,
      serverAvailableBitrateBps: 100_000_000,
      qpAverage: 30,
      mediaFlowState: "flowing",
    };
    for (let index = 0; index < 4; index += 1) {
      expect(controller.observe(sample, bandwidthSettings).type).toBe("none");
    }
    expect(controller.observe(sample, bandwidthSettings)).toMatchObject({
      type: "bitrate",
      maxBitrateBps: 50_000_000,
    });
  });
});
