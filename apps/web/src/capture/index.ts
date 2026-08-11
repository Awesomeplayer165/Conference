export type {
  DisplayEnvironment,
  NativeScaleDecision,
} from "./policy.js";
export {
  AUTOMATIC_CAPTURE_FPS_CEILING,
  contentHintForMode,
  initialCaptureRequest,
  nativeScaleDecision,
  normalizeCaptureCapabilities,
  requestedCaptureConstraints,
  toMediaTrackConstraints,
} from "./policy.js";
export {
  normalizeCaptureSettings,
  normalizeDisplayCaptureError,
  startDisplayCapture,
} from "./startDisplayCapture.js";
export type {
  DisplayCaptureCapabilities,
  DisplayCaptureError,
  DisplayCaptureReport,
  DisplayCaptureSession,
  DisplayCaptureSettings,
  NumericCapability,
  PixelRatioSource,
  RequestedCaptureConstraints,
  StartDisplayCaptureOptions,
} from "./types.js";
