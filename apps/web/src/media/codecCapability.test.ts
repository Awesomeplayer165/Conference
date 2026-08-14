import { describe, expect, it } from "bun:test";
import { selectBalancedEncodingMode, selectSmoothCodec } from "./codecCapability.js";

describe("runtime codec selection", () => {
  it("falls back when advertised AV1 is explicitly unsmooth at the requested mode", () => {
    expect(
      selectSmoothCodec({
        preferred: "video/AV1",
        compatible: ["video/AV1", "video/H264"],
        av1: { supported: true, smooth: false, powerEfficient: false },
        h264: { supported: true, smooth: true, powerEfficient: true },
      }),
    ).toBe("video/H264");
  });

  it("keeps AV1 when smoothness is unknown instead of guessing from the user agent", () => {
    expect(
      selectSmoothCodec({
        preferred: "video/AV1",
        compatible: ["video/AV1", "video/H264"],
        av1: { supported: null, smooth: null, powerEfficient: null },
        h264: { supported: true, smooth: true, powerEfficient: true },
      }),
    ).toBe("video/AV1");
  });
});

describe("balanced encoding plan", () => {
  const capable = (smooth: boolean, powerEfficient: boolean) => ({
    supported: true,
    smooth,
    powerEfficient,
  });

  it("keeps requested cadence by reducing resolution before reducing FPS", () => {
    const plan = selectBalancedEncodingMode(
      [
        {
          codec: "video/AV1",
          fps: 120,
          scaleResolutionDownBy: 1,
          capability: capable(false, false),
          desiredFps: true,
        },
        {
          codec: "video/AV1",
          fps: 120,
          scaleResolutionDownBy: 1.5,
          capability: capable(true, true),
          desiredFps: true,
        },
        {
          codec: "video/AV1",
          fps: 60,
          scaleResolutionDownBy: 1,
          capability: capable(true, true),
          desiredFps: false,
        },
      ],
      {
        codec: "video/AV1",
        fps: 60,
        scaleResolutionDownBy: 1,
        capability: capable(false, false),
      },
    );
    expect(plan.fps).toBe(120);
    expect(plan.scaleResolutionDownBy).toBe(1.5);
  });

  it("keeps a smooth preferred codec before considering a fallback codec", () => {
    const plan = selectBalancedEncodingMode(
      [
        {
          codec: "video/AV1",
          fps: 60,
          scaleResolutionDownBy: 1,
          capability: capable(true, false),
          desiredFps: true,
        },
        {
          codec: "video/H264",
          fps: 60,
          scaleResolutionDownBy: 1,
          capability: capable(true, true),
          desiredFps: true,
        },
      ],
      {
        codec: "video/AV1",
        fps: 60,
        scaleResolutionDownBy: 1,
        capability: capable(false, false),
      },
    );
    expect(plan.codec).toBe("video/AV1");
  });

  it("uses the next codec when the preferred codec has no smooth mode", () => {
    const plan = selectBalancedEncodingMode(
      [
        {
          codec: "video/AV1",
          fps: 120,
          scaleResolutionDownBy: 1,
          capability: capable(false, false),
          desiredFps: true,
        },
        {
          codec: "video/H264",
          fps: 120,
          scaleResolutionDownBy: 1,
          capability: capable(true, true),
          desiredFps: true,
        },
      ],
      {
        codec: "video/AV1",
        fps: 120,
        scaleResolutionDownBy: 1,
        capability: capable(false, false),
      },
    );
    expect(plan.codec).toBe("video/H264");
    expect(plan.fps).toBe(120);
  });
});
