import type { ContentMode, HdrMetadata, VideoCodec } from "@conference/protocol";
import { recommendScreenMinimumBitrateBps } from "./h264Bitrate.js";

export interface ProducerFrameRateInput {
  requestedFps: number;
  userEdited: boolean;
  reportedCapabilityMax: number | null;
  trackFrameRate: number | null;
}

/** A manual ideal request must reach the browser even when capability reports are conservative. */
export function selectProducerMaxFps(input: ProducerFrameRateInput): number {
  if (input.userEdited) {
    // getSettings().frameRate is the rate the browser actually applied to this
    // track, unlike a sometimes-conservative capability maximum.
    return input.trackFrameRate === null
      ? input.requestedFps
      : Math.min(input.requestedFps, input.trackFrameRate);
  }
  return input.trackFrameRate ?? input.reportedCapabilityMax ?? input.requestedFps;
}

/** Motion-first operation protects cadence; detail mode explicitly protects resolution. */
export function degradationPreferenceForContent(
  _contentMode: ContentMode,
): RTCDegradationPreference {
  return "maintain-framerate";
}

export function createProducerSettings(input: {
  width: number | null;
  height: number | null;
  maxFps: number;
  maxBitrateBps: number;
  contentMode: ContentMode;
  hdrMetadata?: HdrMetadata;
  preferredCodec?: VideoCodec;
  fallbackCodec?: VideoCodec;
  scaleResolutionDownBy?: number;
}) {
  const minBitrateBps =
    input.width === null || input.height === null
      ? Math.min(2_000_000, input.maxBitrateBps)
      : recommendScreenMinimumBitrateBps(
          { width: input.width, height: input.height, fps: input.maxFps },
          input.maxBitrateBps,
        );
  return {
    maxFps: input.maxFps,
    maxBitrateBps: input.maxBitrateBps,
    minBitrateBps,
    contentMode: input.contentMode,
    scaleResolutionDownBy: input.scaleResolutionDownBy ?? 1,
    ...(input.hdrMetadata ? { hdrMetadata: input.hdrMetadata } : {}),
    ...(input.preferredCodec ? { preferredCodec: input.preferredCodec } : {}),
    ...(input.fallbackCodec ? { fallbackCodec: input.fallbackCodec } : {}),
  };
}
