import { describe, expect, it } from "bun:test";
import { createEmptyStatisticsSummary } from "@conference/protocol";
import { BalancedMediaController } from "./balancedController.js";

const settings = {
  activeCodec: "video/AV1" as const,
  automaticBitrate: true,
  bitrateCeilingBps: 100_000_000,
  fallbackCodec: "video/H264" as const,
  maxBitrateBps: 40_000_000,
  maxFps: 60,
  preferredCodec: "video/AV1" as const,
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
    expect(controller.observe(sample, settings)).toMatchObject({
      type: "scale",
      scaleResolutionDownBy: 1.67,
    });
  });

  it("reduces software AV1 to 50 percent before considering H.264", () => {
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
    expect(controller.observe(sample, settings)).toMatchObject({
      type: "scale",
      scaleResolutionDownBy: 2,
    });

    const halfResolution = { ...settings, scaleResolutionDownBy: 2 };
    controller.observe(sample, halfResolution);
    controller.observe(sample, halfResolution);
    expect(controller.observe(sample, halfResolution)).toMatchObject({
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

  it("does not reduce resolution when the source itself is cadence limited", () => {
    const controller = new BalancedMediaController();
    const sample = {
      ...createEmptyStatisticsSummary(),
      captureFps: 12,
      encodeFps: 12,
      encodeTimeMsPerFrame: 4,
      qualityLimitationReason: "none",
      mediaFlowState: "flowing",
    };
    for (let index = 0; index < 5; index += 1) {
      expect(controller.observe(sample, settings).type).toBe("none");
    }
  });

  it("reduces resolution when an active hardware capture pipeline cannot feed motion cadence", () => {
    const controller = new BalancedMediaController();
    const highCadence = {
      ...settings,
      maxFps: 120,
      maxBitrateBps: 100_000_000,
    };
    const sample = {
      ...createEmptyStatisticsSummary(),
      captureFps: 48,
      previewFps: 48,
      encodeFps: 48,
      encodeTimeMsPerFrame: 5,
      actualBitrateBps: 60_000_000,
      encoderImplementation: "MediaFoundationVideoEncodeAccelerator (NVIDIA AV1 Encoder MFT)",
      qualityLimitationReason: "none",
      mediaFlowState: "flowing",
    };
    expect(controller.observe(sample, highCadence).type).toBe("none");
    expect(controller.observe(sample, highCadence)).toMatchObject({
      type: "scale",
      scaleResolutionDownBy: 1.67,
    });
  });

  it("does not replace hardware AV1 with a software fallback under compute pressure", () => {
    const controller = new BalancedMediaController();
    const halfResolution = {
      ...settings,
      maxFps: 120,
      scaleResolutionDownBy: 2,
    };
    const sample = {
      ...createEmptyStatisticsSummary(),
      codec: "video/AV1",
      captureFps: 48,
      encodeFps: 48,
      encodeTimeMsPerFrame: 12,
      actualBitrateBps: 60_000_000,
      encoderImplementation: "MediaFoundationVideoEncodeAccelerator (NVIDIA AV1 Encoder MFT)",
      qualityLimitationReason: "cpu",
      mediaFlowState: "flowing",
    };
    for (let index = 0; index < 6; index += 1) {
      expect(controller.observe(sample, halfResolution).type).toBe("none");
    }
  });

  it("restores detail after a short stable window", () => {
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
    for (let index = 0; index < 5; index += 1) {
      expect(controller.observe(sample, scaled).type).toBe("none");
    }
    expect(controller.observe(sample, scaled)).toMatchObject({
      type: "scale",
      scaleResolutionDownBy: 1.33,
    });
  });

  it("restores detail while static even when the browser reports a lower cadence", () => {
    const controller = new BalancedMediaController();
    const scaled = { ...settings, scaleResolutionDownBy: 1.5 };
    const sample = {
      ...createEmptyStatisticsSummary(),
      captureFps: 48,
      encodeFps: 48,
      encodeTimeMsPerFrame: 4,
      qualityLimitationReason: "none",
      actualBitrateBps: 5_000_000,
      qpAverage: 12,
      mediaFlowState: "flowing",
    };
    for (let index = 0; index < 5; index += 1) {
      expect(controller.observe(sample, scaled).type).toBe("none");
    }
    expect(controller.observe(sample, scaled)).toMatchObject({
      type: "scale",
      scaleResolutionDownBy: 1.33,
    });
  });

  it("uses the viewer bottleneck for the automatic quality ceiling", () => {
    const controller = new BalancedMediaController();
    const bandwidthSettings = { ...settings, maxBitrateBps: 40_000_000 };
    const sample = {
      ...createEmptyStatisticsSummary(),
      captureFps: 60,
      encodeFps: 60,
      encodeTimeMsPerFrame: 4,
      qualityLimitationReason: "none",
      encoderTargetBitrateBps: 38_000_000,
      availableOutgoingBitrateBps: 100_000_000,
      serverAvailableBitrateBps: 100_000_000,
      qpAverage: 30,
      mediaFlowState: "flowing",
    };
    const peer = {
      ...createEmptyStatisticsSummary(),
      serverAvailableBitrateBps: 65_000_000,
    };
    for (let index = 0; index < 3; index += 1) {
      expect(controller.observe(sample, bandwidthSettings, peer).type).toBe("none");
    }
    expect(controller.observe(sample, bandwidthSettings, peer)).toMatchObject({
      type: "bitrate",
      maxBitrateBps: 50_000_000,
    });
  });

  it("does not lock the ceiling to a conservative startup bandwidth estimate", () => {
    const controller = new BalancedMediaController();
    const sample = {
      ...createEmptyStatisticsSummary(),
      availableOutgoingBitrateBps: 20_000_000,
      serverAvailableBitrateBps: 20_000_000,
      mediaFlowState: "flowing",
    };
    const highCeiling = { ...settings, maxBitrateBps: 50_000_000 };
    for (let index = 0; index < 12; index += 1) {
      expect(controller.observe(sample, highCeiling).type).toBe("none");
    }
  });

  it("lowers the ceiling after sustained packet-path distress", () => {
    const controller = new BalancedMediaController();
    const sample = {
      ...createEmptyStatisticsSummary(),
      availableOutgoingBitrateBps: 20_000_000,
      serverAvailableBitrateBps: 20_000_000,
      packetSendDelayMsPerPacket: 25,
      mediaFlowState: "flowing",
    };
    const highCeiling = { ...settings, maxBitrateBps: 50_000_000 };
    for (let index = 0; index < 7; index += 1) {
      expect(controller.observe(sample, highCeiling).type).toBe("none");
    }
    expect(controller.observe(sample, highCeiling)).toMatchObject({
      type: "bitrate",
      maxBitrateBps: 18_000_000,
    });
  });

  it("retries AV1 after a stable temporary H.264 recovery", () => {
    const controller = new BalancedMediaController();
    const h264Settings = {
      ...settings,
      activeCodec: "video/H264" as const,
      scaleResolutionDownBy: 2,
    };
    const sample = {
      ...createEmptyStatisticsSummary(),
      codec: "video/H264",
      captureFps: 60,
      encodeFps: 60,
      encodeTimeMsPerFrame: 4,
      qualityLimitationReason: "none",
      mediaFlowState: "flowing",
    };
    for (let index = 0; index < 29; index += 1) {
      controller.observe(sample, h264Settings);
    }
    expect(controller.observe(sample, h264Settings)).toMatchObject({
      type: "codec",
      codec: "video/AV1",
    });
  });
});
