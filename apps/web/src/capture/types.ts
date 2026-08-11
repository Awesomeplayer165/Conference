import type { ContentMode } from "@conference/protocol";

export interface NumericCapability {
  min: number | null;
  max: number | null;
}

export interface DisplayCaptureCapabilities {
  width: NumericCapability;
  height: NumericCapability;
  frameRate: NumericCapability;
}

export interface DisplayCaptureSettings {
  width: number | null;
  height: number | null;
  frameRate: number | null;
  aspectRatio: number | null;
  displaySurface: string | null;
  logicalSurface: boolean | null;
  cursor: string | null;
  resizeMode: string | null;
  screenPixelRatio: number | null;
}

export interface RequestedCaptureConstraints {
  widthIdeal: number | null;
  heightIdeal: number | null;
  frameRateIdeal: number | null;
  resizeModeIdeal: "none" | null;
}

export type PixelRatioSource =
  | "track-setting"
  | "manual-override"
  | "window-heuristic"
  | "not-applied";

export interface DisplayCaptureReport {
  capabilities: DisplayCaptureCapabilities;
  settingsBeforeConstraints: DisplayCaptureSettings;
  settingsAfterConstraints: DisplayCaptureSettings;
  initialConstraints: RequestedCaptureConstraints;
  requestedConstraints: RequestedCaptureConstraints;
  constraintsApplied: boolean;
  nativeScaleMultiplier: number;
  pixelRatioSource: PixelRatioSource;
  contentMode: ContentMode;
  requestedContentHint: string;
  acceptedContentHint: string | null;
  contentHintSupported: boolean;
  warnings: readonly string[];
}

export interface StartDisplayCaptureOptions {
  maxFramerate: number | null;
  contentMode: ContentMode;
  requestNativePixels: boolean;
  pixelRatioOverride: number | null;
}

export interface DisplayCaptureSession {
  stream: MediaStream;
  track: MediaStreamTrack;
  report: DisplayCaptureReport;
  stop: () => void;
}

export type DisplayCaptureErrorCode = "unsupported" | "cancelled-or-denied" | "capture-failed";

export interface DisplayCaptureError {
  code: DisplayCaptureErrorCode;
  message: string;
}
