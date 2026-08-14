import {
  type MediaRequestMessage,
  type MediaResponseMessage,
  PROTOCOL_VERSION,
  type VideoCodec,
} from "@conference/protocol";
import { expectMediaResponse, mediaRequestId } from "./mediaSessionProtocol.js";

type RecoveryRequester = (message: MediaRequestMessage) => Promise<MediaResponseMessage>;

export async function requestConsumerKeyFrame(
  request: RecoveryRequester,
  consumerId: string,
): Promise<void> {
  expectMediaResponse(
    await request({
      type: "media.requestConsumerKeyFrame",
      protocolVersion: PROTOCOL_VERSION,
      requestId: mediaRequestId(),
      consumerId,
    }),
    "media.ack",
  );
}

export async function requestCodecFallback(
  request: RecoveryRequester,
  consumerId: string,
  requestedCodec: VideoCodec,
): Promise<void> {
  expectMediaResponse(
    await request({
      type: "media.requestCodecFallback",
      protocolVersion: PROTOCOL_VERSION,
      requestId: mediaRequestId(),
      consumerId,
      requestedCodec,
    }),
    "media.ack",
  );
}
