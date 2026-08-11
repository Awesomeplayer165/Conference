import {
  contentHintForMode,
  initialCaptureRequest,
  nativeScaleDecision,
  normalizeCaptureCapabilities,
  requestedCaptureConstraints,
  toMediaTrackConstraints,
} from "./policy.js";
import type {
  DisplayCaptureError,
  DisplayCaptureSession,
  DisplayCaptureSettings,
  StartDisplayCaptureOptions,
} from "./types.js";

type ExtendedDisplaySettings = MediaTrackSettings & {
  cursor?: string;
  displaySurface?: string;
  logicalSurface?: boolean;
  resizeMode?: string;
  screenPixelRatio?: number;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeCaptureSettings(
  settings: MediaTrackSettings | ExtendedDisplaySettings,
): DisplayCaptureSettings {
  const display = settings as ExtendedDisplaySettings;
  return {
    width: finiteNumber(display.width),
    height: finiteNumber(display.height),
    frameRate: finiteNumber(display.frameRate),
    aspectRatio: finiteNumber(display.aspectRatio),
    displaySurface: typeof display.displaySurface === "string" ? display.displaySurface : null,
    logicalSurface: typeof display.logicalSurface === "boolean" ? display.logicalSurface : null,
    cursor: typeof display.cursor === "string" ? display.cursor : null,
    resizeMode: typeof display.resizeMode === "string" ? display.resizeMode : null,
    screenPixelRatio: finiteNumber(display.screenPixelRatio),
  };
}

export function normalizeDisplayCaptureError(error: unknown): DisplayCaptureError {
  if (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  ) {
    return {
      code: "cancelled-or-denied",
      message: "Screen selection was cancelled or capture permission was denied.",
    };
  }
  if (error instanceof DOMException && error.name === "NotSupportedError") {
    return {
      code: "unsupported",
      message: "Display capture is not supported in this browser context.",
    };
  }
  return {
    code: "capture-failed",
    message: error instanceof Error ? error.message : "Display capture failed.",
  };
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function displayEnvironment() {
  return {
    logicalWidth: typeof screen === "undefined" ? null : finiteNumber(screen.width),
    logicalHeight: typeof screen === "undefined" ? null : finiteNumber(screen.height),
    windowPixelRatio: typeof window === "undefined" ? null : finiteNumber(window.devicePixelRatio),
  };
}

export async function startDisplayCapture(
  options: StartDisplayCaptureOptions,
): Promise<DisplayCaptureSession> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new DOMException("getDisplayMedia is unavailable", "NotSupportedError");
  }

  const environment = displayEnvironment();
  const initialConstraints = initialCaptureRequest(
    options.maxFramerate,
    options.requestNativePixels,
    options.pixelRatioOverride,
    environment,
  );
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: toMediaTrackConstraints(initialConstraints),
    audio: false,
  });
  const [track] = stream.getVideoTracks();
  if (!track) {
    stopStream(stream);
    throw new Error("Display capture returned no video track.");
  }

  for (const audioTrack of stream.getAudioTracks()) {
    audioTrack.stop();
    stream.removeTrack(audioTrack);
  }

  const settingsBeforeConstraints = normalizeCaptureSettings(track.getSettings());
  const capabilities = normalizeCaptureCapabilities(
    typeof track.getCapabilities === "function" ? track.getCapabilities() : {},
  );
  const scaleDecision = nativeScaleDecision(
    capabilities,
    settingsBeforeConstraints,
    options.requestNativePixels,
    options.pixelRatioOverride,
    environment,
  );
  const request = requestedCaptureConstraints(
    capabilities,
    options.maxFramerate,
    scaleDecision.multiplier,
    options.requestNativePixels,
  );
  const constraints = toMediaTrackConstraints(request);
  const warnings: string[] = [];
  let constraintsApplied = false;

  if (scaleDecision.source === "window-heuristic") {
    warnings.push(
      `The browser omitted screenPixelRatio. Requested ${scaleDecision.multiplier}× dimensions using the current app window as a monitor heuristic.`,
    );
  }
  if (
    request.frameRateIdeal !== null &&
    capabilities.frameRate.max !== null &&
    request.frameRateIdeal > capabilities.frameRate.max
  ) {
    warnings.push(
      `Requested ${request.frameRateIdeal} FPS even though the browser reported a ${capabilities.frameRate.max} FPS maximum.`,
    );
  }

  if (Object.keys(constraints).length > 0) {
    try {
      await track.applyConstraints(constraints);
      constraintsApplied = true;
    } catch (error) {
      warnings.push(
        `The browser did not apply native-dimension constraints: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  const requestedContentHint = contentHintForMode(options.contentMode);
  const contentHintSupported = "contentHint" in track;
  let acceptedContentHint: string | null = null;
  if (contentHintSupported) {
    try {
      track.contentHint = requestedContentHint;
      acceptedContentHint = track.contentHint;
    } catch (error) {
      warnings.push(
        `The browser rejected the content hint: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  const settingsAfterConstraints = normalizeCaptureSettings(track.getSettings());
  if (
    request.frameRateIdeal !== null &&
    settingsAfterConstraints.frameRate !== null &&
    settingsAfterConstraints.frameRate + 0.5 < request.frameRateIdeal
  ) {
    warnings.push(
      `The browser clamped the track to ${settingsAfterConstraints.frameRate} FPS; JavaScript cannot force the requested ${request.frameRateIdeal} FPS beyond this browser/OS limit.`,
    );
  }
  if (
    request.widthIdeal !== null &&
    settingsAfterConstraints.width !== null &&
    settingsAfterConstraints.width < request.widthIdeal
  ) {
    warnings.push(
      `The browser returned ${settingsAfterConstraints.width} px width after a ${request.widthIdeal} px ideal request. Upscaling this in the app would not restore source detail.`,
    );
  }
  if (
    options.requestNativePixels &&
    settingsAfterConstraints.resizeMode !== null &&
    settingsAfterConstraints.resizeMode !== "none"
  ) {
    warnings.push(
      `The browser reported resizeMode=${settingsAfterConstraints.resizeMode} after native-pixel mode was requested.`,
    );
  }

  return {
    stream,
    track,
    report: {
      capabilities,
      settingsBeforeConstraints,
      settingsAfterConstraints,
      initialConstraints,
      requestedConstraints: request,
      constraintsApplied,
      nativeScaleMultiplier: scaleDecision.multiplier,
      pixelRatioSource: scaleDecision.source,
      contentMode: options.contentMode,
      requestedContentHint,
      acceptedContentHint,
      contentHintSupported,
      warnings,
    },
    stop: () => stopStream(stream),
  };
}
