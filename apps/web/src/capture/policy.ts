import type { ContentMode } from "@conference/protocol";
import type {
  DisplayCaptureCapabilities,
  DisplayCaptureSettings,
  NumericCapability,
  PixelRatioSource,
  RequestedCaptureConstraints,
} from "./types.js";

export const AUTOMATIC_CAPTURE_FPS_CEILING = 120;

export interface DisplayEnvironment {
  logicalWidth: number | null;
  logicalHeight: number | null;
  windowPixelRatio: number | null;
}

export interface NativeScaleDecision {
  multiplier: number;
  source: PixelRatioSource;
}

export interface DisplayMediaTrackConstraints extends MediaTrackConstraints {
  resizeMode?: string | { ideal: string };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericCapability(value: unknown): NumericCapability {
  if (typeof value === "number") {
    const number = finiteNumber(value);
    return { min: number, max: number };
  }
  if (typeof value !== "object" || value === null) {
    return { min: null, max: null };
  }
  const range = value as { min?: unknown; max?: unknown };
  return {
    min: finiteNumber(range.min),
    max: finiteNumber(range.max),
  };
}

export function normalizeCaptureCapabilities(
  capabilities: MediaTrackCapabilities | Record<string, unknown>,
): DisplayCaptureCapabilities {
  const values = capabilities as Record<string, unknown>;
  return {
    width: numericCapability(values.width),
    height: numericCapability(values.height),
    frameRate: numericCapability(values.frameRate),
  };
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function roundedProduct(value: number | null, multiplier: number): number | null {
  const number = positive(value);
  return number === null ? null : Math.round(number * multiplier);
}

export function initialCaptureRequest(
  maxFramerate: number | null,
  requestNativePixels: boolean,
  pixelRatioOverride: number | null,
  environment: DisplayEnvironment,
): RequestedCaptureConstraints {
  const ratio = requestNativePixels
    ? (positive(pixelRatioOverride) ?? positive(environment.windowPixelRatio) ?? 1)
    : 1;
  return {
    widthIdeal: roundedProduct(environment.logicalWidth, ratio),
    heightIdeal: roundedProduct(environment.logicalHeight, ratio),
    frameRateIdeal: positive(maxFramerate) ?? AUTOMATIC_CAPTURE_FPS_CEILING,
    resizeModeIdeal: requestNativePixels ? "none" : null,
  };
}

export function nativeScaleDecision(
  capabilities: DisplayCaptureCapabilities,
  settings: DisplayCaptureSettings,
  requestNativePixels: boolean,
  pixelRatioOverride: number | null,
  environment: DisplayEnvironment,
): NativeScaleDecision {
  if (!requestNativePixels) {
    return { multiplier: 1, source: "not-applied" };
  }
  const override = positive(pixelRatioOverride);
  if (override !== null) {
    return { multiplier: override, source: "manual-override" };
  }

  // The specification says capability maxima are physical pixels, so a
  // reported track ratio is diagnostic and must not multiply them again.
  if (positive(settings.screenPixelRatio) !== null) {
    return { multiplier: 1, source: "track-setting" };
  }

  // Safari may expose only logical dimensions and omit screenPixelRatio.
  // Use the app window's ratio only when the selected monitor width closely
  // matches the current screen's logical width. This is intentionally a
  // heuristic and can be overridden for a different monitor.
  const capabilityWidth = positive(capabilities.width.max);
  const logicalWidth = positive(environment.logicalWidth);
  const windowRatio = positive(environment.windowPixelRatio);
  if (
    settings.displaySurface === "monitor" &&
    capabilityWidth !== null &&
    logicalWidth !== null &&
    windowRatio !== null &&
    windowRatio > 1 &&
    capabilityWidth <= logicalWidth * 1.1
  ) {
    return { multiplier: windowRatio, source: "window-heuristic" };
  }

  return { multiplier: 1, source: "not-applied" };
}

export function requestedCaptureConstraints(
  capabilities: DisplayCaptureCapabilities,
  maxFramerate: number | null,
  nativeScaleMultiplier = 1,
  requestNativePixels = true,
): RequestedCaptureConstraints {
  const capabilityFrameRate = positive(capabilities.frameRate.max);
  const requestedFrameRate = positive(maxFramerate);
  return {
    widthIdeal: roundedProduct(capabilities.width.max, nativeScaleMultiplier),
    heightIdeal: roundedProduct(capabilities.height.max, nativeScaleMultiplier),
    // A manual request is intentionally not clamped to getCapabilities().
    // Browsers may initialize a conservative 30 FPS capability and still
    // accept a higher ideal, or they may clamp it. The report records either.
    frameRateIdeal: requestedFrameRate ?? capabilityFrameRate,
    resizeModeIdeal: requestNativePixels ? "none" : null,
  };
}

export function toMediaTrackConstraints(
  request: RequestedCaptureConstraints,
): DisplayMediaTrackConstraints {
  return {
    ...(request.widthIdeal === null ? {} : { width: { ideal: request.widthIdeal } }),
    ...(request.heightIdeal === null ? {} : { height: { ideal: request.heightIdeal } }),
    ...(request.frameRateIdeal === null ? {} : { frameRate: { ideal: request.frameRateIdeal } }),
    ...(request.resizeModeIdeal === null ? {} : { resizeMode: { ideal: request.resizeModeIdeal } }),
  };
}

export function contentHintForMode(mode: ContentMode): string {
  switch (mode) {
    case "detail":
      return "detail";
    case "motion":
      return "motion";
    case "auto":
      return "";
  }
}
