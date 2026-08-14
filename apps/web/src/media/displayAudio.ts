import { PROTOCOL_VERSION } from "@conference/protocol";
import type { Producer, Transport } from "mediasoup-client/types";
import type { MediaRequester } from "./MediasoupSession.js";
import { expectMediaResponse, mediaRequestId } from "./mediaSessionProtocol.js";

export async function produceDisplayAudio(
  transport: Transport,
  track: MediaStreamTrack,
): Promise<Producer> {
  return transport.produce({
    track,
    stopTracks: false,
    encodings: [{ maxBitrate: 256_000, networkPriority: "high", priority: "high" }],
    codecOptions: {
      opusDtx: false,
      opusFec: true,
      opusMaxPlaybackRate: 48_000,
      opusStereo: true,
    },
    appData: { source: "display-audio" },
  });
}

export async function closeRemoteProducers(
  producers: Array<Producer | null>,
  request: MediaRequester,
): Promise<void> {
  await Promise.all(
    producers
      .filter((item): item is Producer => item !== null)
      .map(async (producer) => {
        if (producer.closed) return;
        try {
          expectMediaResponse(
            await request({
              type: "media.closeProducer",
              protocolVersion: PROTOCOL_VERSION,
              requestId: mediaRequestId(),
              producerId: producer.id,
            }),
            "media.ack",
          );
        } finally {
          producer.close();
        }
      }),
  );
}
