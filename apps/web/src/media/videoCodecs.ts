import type { VideoCodec, VideoCodecCapabilities } from "@conference/protocol";

export const VIDEO_CODEC_PREFERENCE: readonly VideoCodec[] = [
  "video/AV1",
  "video/H265",
  "video/H264",
];

interface CodecLike {
  mimeType: string;
}

function normalizeVideoCodec(mimeType: string): VideoCodec | null {
  switch (mimeType.toLowerCase()) {
    case "video/av1":
      return "video/AV1";
    case "video/h265":
    case "video/hevc":
      return "video/H265";
    case "video/h264":
      return "video/H264";
    default:
      return null;
  }
}

export function supportedVideoCodecs(codecs: readonly CodecLike[] | undefined): VideoCodec[] {
  const available = new Set(
    (codecs ?? []).map((codec) => normalizeVideoCodec(codec.mimeType)).filter(Boolean),
  );
  return VIDEO_CODEC_PREFERENCE.filter((codec) => available.has(codec));
}

export function detectVideoCodecCapabilities(): VideoCodecCapabilities {
  let send: readonly CodecLike[] | undefined;
  let receive: readonly CodecLike[] | undefined;
  try {
    send = RTCRtpSender.getCapabilities?.("video")?.codecs;
  } catch {
    send = undefined;
  }
  try {
    receive = RTCRtpReceiver.getCapabilities?.("video")?.codecs;
  } catch {
    receive = undefined;
  }
  return {
    send: supportedVideoCodecs(send),
    receive: supportedVideoCodecs(receive),
  };
}

export function displayVideoCodec(codec: VideoCodec): string {
  switch (codec) {
    case "video/AV1":
      return "AV1";
    case "video/H265":
      return "H.265";
    case "video/H264":
      return "H.264";
  }
}
