import { describe, expect, it } from "bun:test";
import { normalizeCaptureSettings, normalizeDisplayCaptureError } from "./startDisplayCapture.js";

describe("capture normalization", () => {
  it("keeps source geometry and browser-specific screen settings distinct", () => {
    expect(
      normalizeCaptureSettings({
        width: 3024,
        height: 1964,
        frameRate: 59.94,
        aspectRatio: 3024 / 1964,
        displaySurface: "monitor",
        logicalSurface: true,
        screenPixelRatio: 2,
      }),
    ).toMatchObject({
      width: 3024,
      height: 1964,
      frameRate: 59.94,
      displaySurface: "monitor",
      logicalSurface: true,
      screenPixelRatio: 2,
    });
  });

  it("represents absent settings as null rather than zero", () => {
    expect(normalizeCaptureSettings({})).toEqual({
      width: null,
      height: null,
      frameRate: null,
      aspectRatio: null,
      displaySurface: null,
      logicalSurface: null,
      cursor: null,
      resizeMode: null,
      screenPixelRatio: null,
    });
  });

  it("distinguishes picker cancellation from capture failure", () => {
    expect(
      normalizeDisplayCaptureError(new DOMException("Permission denied", "NotAllowedError")),
    ).toMatchObject({ code: "cancelled-or-denied" });
    expect(normalizeDisplayCaptureError(new Error("encoder unavailable"))).toEqual({
      code: "capture-failed",
      message: "encoder unavailable",
    });
  });
});
