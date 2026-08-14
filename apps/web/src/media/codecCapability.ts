import type { HdrMetadata, VideoCodec } from "@conference/protocol";
import { h264BaselineProfileLevelId } from "./h264Capability.js";

export interface VideoEncodingCapability {
  supported: boolean | null;
  smooth: boolean | null;
  powerEfficient: boolean | null;
}

export interface BalancedEncodingPlan {
  codec: VideoCodec;
  fps: number;
  scaleResolutionDownBy: number;
  capability: VideoEncodingCapability;
  fallbackCodec?: VideoCodec;
}

interface ProbedEncodingMode extends BalancedEncodingPlan {
  desiredFps: boolean;
}

type EncodingConfiguration = {
  type: "webrtc";
  video: {
    contentType: string;
    width: number;
    height: number;
    bitrate: number;
    framerate: number;
    colorGamut?: "rec2020";
    transferFunction?: "pq" | "hlg";
  };
};

interface EncodingCapabilities {
  encodingInfo: (configuration: EncodingConfiguration) => Promise<{
    supported: boolean;
    smooth: boolean;
    powerEfficient: boolean;
  }>;
}

const UNKNOWN_CAPABILITY: VideoEncodingCapability = {
  supported: null,
  smooth: null,
  powerEfficient: null,
};

const BALANCED_SCALES = [1, 1.25, 1.5, 2, 2.5, 3] as const;

function encodingContentType(
  codec: VideoCodec,
  width: number,
  height: number,
  fps: number,
): string {
  switch (codec) {
    case "video/AV1":
      return "video/webm;codecs=av01.0.08M.08";
    case "video/H265":
      return "video/mp4;codecs=hvc1.1.6.L123.B0";
    case "video/H264":
      return `video/mp4;codecs=avc1.${h264BaselineProfileLevelId(width, height, fps).toUpperCase()}`;
  }
}

export async function probeVideoEncodingCapability(input: {
  codec: VideoCodec;
  width: number;
  height: number;
  fps: number;
  bitrateBps: number;
  hdrMetadata?: HdrMetadata;
}): Promise<VideoEncodingCapability> {
  const capabilities = navigator.mediaCapabilities as unknown as EncodingCapabilities | undefined;
  if (!capabilities?.encodingInfo) {
    return UNKNOWN_CAPABILITY;
  }
  const hdr = input.hdrMetadata;
  const hdrTransfer = hdr?.mode === "hdr-pq" ? "pq" : hdr?.mode === "hdr-hlg" ? "hlg" : null;
  try {
    const result = await capabilities.encodingInfo({
      type: "webrtc",
      video: {
        contentType: encodingContentType(input.codec, input.width, input.height, input.fps),
        width: Math.round(input.width),
        height: Math.round(input.height),
        bitrate: Math.round(input.bitrateBps),
        framerate: input.fps,
        ...(hdrTransfer ? { colorGamut: "rec2020", transferFunction: hdrTransfer } : {}),
      },
    });
    return {
      supported: result.supported,
      smooth: result.smooth,
      powerEfficient: result.powerEfficient,
    };
  } catch {
    return UNKNOWN_CAPABILITY;
  }
}

export function selectBalancedEncodingMode(
  modes: readonly ProbedEncodingMode[],
  fallback: BalancedEncodingPlan,
): BalancedEncodingPlan {
  for (const desiredFps of [true, false]) {
    const matchingFps = modes.filter((mode) => mode.desiredFps === desiredFps);
    const codecs = [...new Set(matchingFps.map((mode) => mode.codec))];
    for (const codec of codecs) {
      const codecModes = matchingFps.filter((mode) => mode.codec === codec);
      const hardwareSmooth = codecModes.find(
        (mode) => mode.capability.smooth === true && mode.capability.powerEfficient === true,
      );
      const selected = hardwareSmooth ?? codecModes.find((mode) => mode.capability.smooth === true);
      if (selected) {
        return selected;
      }
    }
  }
  return fallback;
}

export async function planBalancedEncoding(input: {
  preferred: VideoCodec;
  compatible: readonly VideoCodec[];
  width: number;
  height: number;
  requestedFps: number;
  bitrateBps: number;
  hdrMetadata?: HdrMetadata;
}): Promise<BalancedEncodingPlan> {
  const codecs = [
    input.preferred,
    ...input.compatible.filter((codec) => codec !== input.preferred),
  ];
  const uniqueCodecs = [...new Set(codecs)].filter((codec) => input.compatible.includes(codec));
  const frameRates = [input.requestedFps];
  const modes = await Promise.all(
    frameRates.flatMap((fps) =>
      uniqueCodecs.flatMap((codec) =>
        BALANCED_SCALES.map(
          async (scaleResolutionDownBy): Promise<ProbedEncodingMode> => ({
            codec,
            fps,
            scaleResolutionDownBy,
            capability: await probeVideoEncodingCapability({
              codec,
              width: input.width / scaleResolutionDownBy,
              height: input.height / scaleResolutionDownBy,
              fps,
              bitrateBps: input.bitrateBps,
              ...(codec === "video/AV1" && input.hdrMetadata
                ? { hdrMetadata: input.hdrMetadata }
                : {}),
            }),
            desiredFps: fps === input.requestedFps,
          }),
        ),
      ),
    ),
  );
  const fallback: BalancedEncodingPlan = {
    codec: uniqueCodecs[0] ?? input.preferred,
    fps: input.requestedFps,
    scaleResolutionDownBy: 1,
    capability: UNKNOWN_CAPABILITY,
  };
  const selected = selectBalancedEncodingMode(modes, fallback);
  const fallbackCodec =
    modes.find(
      (mode) =>
        mode.codec !== selected.codec &&
        mode.fps === selected.fps &&
        mode.scaleResolutionDownBy === selected.scaleResolutionDownBy &&
        mode.capability.smooth === true &&
        mode.capability.powerEfficient === true,
    )?.codec ?? uniqueCodecs.find((codec) => codec !== selected.codec);
  return { ...selected, ...(fallbackCodec ? { fallbackCodec } : {}) };
}

export function selectSmoothCodec(input: {
  preferred: VideoCodec;
  compatible: readonly VideoCodec[];
  av1: VideoEncodingCapability;
  h264: VideoEncodingCapability;
}): VideoCodec {
  if (
    input.preferred === "video/AV1" &&
    input.av1.smooth === false &&
    input.compatible.includes("video/H264") &&
    input.h264.supported !== false &&
    input.h264.smooth !== false
  ) {
    return "video/H264";
  }
  return input.preferred;
}
