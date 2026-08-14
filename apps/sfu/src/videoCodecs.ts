import type { VideoCodec, VideoCodecCapabilities } from "@conference/protocol";

export const ROUTER_VIDEO_CODEC_PREFERENCE: readonly VideoCodec[] = ["video/AV1", "video/H264"];

export function routedVideoCodec(mimeType: string | undefined): VideoCodec | null {
  return (
    ROUTER_VIDEO_CODEC_PREFERENCE.find(
      (codec) => codec.toLowerCase() === mimeType?.toLowerCase(),
    ) ?? null
  );
}

const LEGACY_H264_CAPABILITIES: VideoCodecCapabilities = {
  send: ["video/H264"],
  receive: ["video/H264"],
};

export function selectVideoCodec(
  host: VideoCodecCapabilities | undefined,
  viewer: VideoCodecCapabilities | undefined,
): VideoCodec | null {
  const hostCapabilities = host ?? LEGACY_H264_CAPABILITIES;
  const viewerCapabilities = viewer ?? LEGACY_H264_CAPABILITIES;
  return (
    ROUTER_VIDEO_CODEC_PREFERENCE.find(
      (codec) =>
        hostCapabilities.send.includes(codec) && viewerCapabilities.receive.includes(codec),
    ) ?? null
  );
}

export function compatibleVideoCodecs(
  host: VideoCodecCapabilities | undefined,
  viewer: VideoCodecCapabilities | undefined,
): VideoCodec[] {
  const hostCapabilities = host ?? LEGACY_H264_CAPABILITIES;
  const viewerCapabilities = viewer ?? LEGACY_H264_CAPABILITIES;
  return ROUTER_VIDEO_CODEC_PREFERENCE.filter(
    (codec) => hostCapabilities.send.includes(codec) && viewerCapabilities.receive.includes(codec),
  );
}
