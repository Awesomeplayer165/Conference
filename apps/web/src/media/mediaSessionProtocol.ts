import type { MediaResponseMessage, VideoCodec } from "@conference/protocol";
import type { RtpCapabilities } from "mediasoup-client/types";

export function mediaRequestId(): string {
  return crypto.randomUUID();
}

export function expectMediaResponse<T extends MediaResponseMessage["type"]>(
  response: MediaResponseMessage,
  type: T,
): Extract<MediaResponseMessage, { type: T }> {
  if (response.type === "media.error") {
    throw new Error(response.message);
  }
  if (response.type !== type) {
    throw new Error(`Expected ${type}, received ${response.type}`);
  }
  return response as Extract<MediaResponseMessage, { type: T }>;
}

export function findNegotiatedCodec(codecs: RtpCapabilities["codecs"], selectedCodec: VideoCodec) {
  const matches = codecs?.filter(
    (codec) =>
      codec.mimeType.toLowerCase() === selectedCodec.toLowerCase() &&
      (selectedCodec !== "video/H264" || codec.parameters?.["packetization-mode"] === 1),
  );
  if (selectedCodec !== "video/H264") {
    return matches?.[0];
  }
  return (
    matches?.find((codec) =>
      String(codec.parameters?.["profile-level-id"] ?? "")
        .toLowerCase()
        .startsWith("4200"),
    ) ?? matches?.[0]
  );
}
