import { describe, expect, it } from "bun:test";
import {
  recommendH264BitrateBps,
  recommendH264StartupBitrateKbps,
  recommendScreenMinimumBitrateBps,
} from "./h264Bitrate.js";

describe("H.264 bitrate recommendation", () => {
  it("scales with arbitrary source geometry and FPS", () => {
    expect(
      recommendH264BitrateBps({
        width: 3024,
        height: 1964,
        fps: 120,
      }),
    ).toBe(71_250_000);
  });

  it("recommends a quality-oriented 1080p60 ceiling", () => {
    expect(
      recommendH264BitrateBps({
        width: 1920,
        height: 1080,
        fps: 60,
      }),
    ).toBe(12_500_000);
  });

  it("applies practical minimum and maximum ceilings", () => {
    expect(recommendH264BitrateBps({ width: 640, height: 480, fps: 5 })).toBe(2_000_000);
    expect(
      recommendH264BitrateBps({
        width: 7680,
        height: 4320,
        fps: 120,
      }),
    ).toBe(100_000_000);
  });
});

describe("H.264 startup bitrate hint", () => {
  it("ramps conservatively without exceeding the configured ceiling", () => {
    expect(recommendH264StartupBitrateKbps(4_000_000)).toBe(2_800);
    expect(recommendH264StartupBitrateKbps(100_000_000)).toBe(50_000);
    expect(recommendH264StartupBitrateKbps(250_000)).toBeLessThanOrEqual(250);
  });
});

describe("screen motion bitrate floor hint", () => {
  it("keeps the hint below half of the ceiling", () => {
    expect(
      recommendScreenMinimumBitrateBps({ width: 3024, height: 1890, fps: 60 }, 50_000_000),
    ).toBe(12_000_000);
    expect(
      recommendScreenMinimumBitrateBps({ width: 3840, height: 2160, fps: 120 }, 20_000_000),
    ).toBe(10_000_000);
  });

  it("never exceeds a low manual ceiling", () => {
    expect(recommendScreenMinimumBitrateBps({ width: 640, height: 480, fps: 5 }, 1_000_000)).toBe(
      1_000_000,
    );
  });
});
