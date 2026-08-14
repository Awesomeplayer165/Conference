import { describe, expect, it } from "bun:test";
import {
  contentHintForMode,
  initialCaptureRequest,
  nativeScaleDecision,
  normalizeCaptureCapabilities,
  requestedCaptureConstraints,
  toMediaTrackConstraints,
} from "./policy.js";

describe("capture policy", () => {
  const capabilities = normalizeCaptureCapabilities({
    width: { min: 1, max: 3024 },
    height: { min: 1, max: 1964 },
    frameRate: { min: 1, max: 60 },
  });

  it("requests the selected surface's actual maxima without named presets", () => {
    const request = requestedCaptureConstraints(capabilities, null);

    expect(request).toEqual({
      widthIdeal: 3024,
      heightIdeal: 1964,
      frameRateIdeal: 60,
      resizeModeIdeal: "none",
    });
    expect(toMediaTrackConstraints(request)).toEqual({
      width: { ideal: 3024 },
      height: { ideal: 1964 },
      frameRate: { ideal: 60 },
      resizeMode: { ideal: "none" },
    });
  });

  it("caps FPS without reducing requested dimensions", () => {
    expect(requestedCaptureConstraints(capabilities, 45)).toEqual({
      widthIdeal: 3024,
      heightIdeal: 1964,
      frameRateIdeal: 45,
      resizeModeIdeal: "none",
    });
  });

  it("allows a manual FPS request above a conservative reported capability", () => {
    expect(requestedCaptureConstraints(capabilities, 120).frameRateIdeal).toBe(120);
  });

  it("requests high fidelity in the initial picker call", () => {
    expect(
      initialCaptureRequest(null, true, null, {
        logicalWidth: 1512,
        logicalHeight: 982,
        windowPixelRatio: 2,
      }),
    ).toEqual({
      widthIdeal: 3024,
      heightIdeal: 1964,
      frameRateIdeal: 120,
      resizeModeIdeal: "none",
    });
  });

  it("uses a window-ratio heuristic for Safari-style logical maxima", () => {
    const logicalCapabilities = normalizeCaptureCapabilities({
      width: { min: 1, max: 1512 },
      height: { min: 1, max: 982 },
      frameRate: { min: 1, max: 30 },
    });
    const decision = nativeScaleDecision(
      logicalCapabilities,
      {
        width: 1512,
        height: 982,
        frameRate: 30,
        aspectRatio: 1512 / 982,
        displaySurface: "monitor",
        logicalSurface: true,
        cursor: null,
        resizeMode: null,
        screenPixelRatio: null,
      },
      true,
      null,
      {
        logicalWidth: 1512,
        logicalHeight: 982,
        windowPixelRatio: 2,
      },
    );

    expect(decision).toEqual({
      multiplier: 2,
      source: "window-heuristic",
    });
    expect(requestedCaptureConstraints(logicalCapabilities, 60, 2)).toEqual({
      widthIdeal: 3024,
      heightIdeal: 1964,
      frameRateIdeal: 60,
      resizeModeIdeal: "none",
    });
  });

  it("maps declared content modes to portable hints", () => {
    expect(contentHintForMode("auto")).toBe("motion");
    expect(contentHintForMode("detail")).toBe("detail");
    expect(contentHintForMode("motion")).toBe("motion");
  });
});
