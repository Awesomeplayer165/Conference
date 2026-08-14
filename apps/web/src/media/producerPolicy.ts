import type { ContentMode, HdrMetadata, VideoCodec } from "@conference/protocol";
import { recommendScreenMinimumBitrateBps } from "./h264Bitrate.js";

export interface ProducerFrameRateInput {
  requestedFps: number;
  userEdited: boolean;
  reportedCapabilityMax: number | null;
  trackFrameRate: number | null;
}

/** Keep the sender ceiling at the requested cadence; capture telemetry reports any source clamp. */
export function selectProducerMaxFps(input: ProducerFrameRateInput): number {
  // getSettings() and getCapabilities() describe the current browser capture
  // outcome, not necessarily a hard encoder maximum. Applying either value as
  // maxFramerate creates a second ceiling that prevents recovery if Chromium's
  // capturer later ramps up. The controller still observes the measured source,
  // encode, decode, and presentation cadence independently.
  return input.requestedFps;
}

/** Motion-first operation protects cadence; detail mode explicitly protects resolution. */
export function degradationPreferenceForContent(
  _contentMode: ContentMode,
): RTCDegradationPreference {
  return "maintain-framerate";
}

/** A single temporal/spatial layer lets Chromium choose any compatible hardware encoder. */
export function createProducerEncoding(input: {
  maxBitrateBps: number;
  maxFps: number;
  scaleResolutionDownBy?: number;
}) {
  return {
    maxBitrate: Math.round(input.maxBitrateBps),
    maxFramerate: input.maxFps,
    networkPriority: "high" as const,
    priority: "high" as const,
    scaleResolutionDownBy: input.scaleResolutionDownBy ?? 1,
  };
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
