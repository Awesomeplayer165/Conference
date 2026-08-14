import type { ContentMode } from "@conference/protocol";
import { type HdrMetadata, PROTOCOL_VERSION, type StatisticsSummary } from "@conference/protocol";
import type {
  Consumer,
  Device,
  Producer,
  RtpParameters,
  Transport,
  TransportOptions,
} from "mediasoup-client/types";
import type { MediaRequester } from "./MediasoupSession.js";
import { expectMediaResponse, mediaRequestId } from "./mediaSessionProtocol.js";
import { degradationPreferenceForContent } from "./producerPolicy.js";

export async function createSessionTransport(
  device: Device,
  request: MediaRequester,
  direction: "send" | "recv",
): Promise<Transport> {
  const response = expectMediaResponse(
    await request({
      type: "media.createTransport",
      protocolVersion: PROTOCOL_VERSION,
      requestId: mediaRequestId(),
      direction,
    }),
    "media.transportCreated",
  );
  const options = response.transport as unknown as TransportOptions<Record<string, unknown>>;
  const browserOptions = {
    ...options,
    iceTransportPolicy: "all" as const,
    additionalSettings: { ...options.additionalSettings, iceCandidatePoolSize: 1 },
  };
  return direction === "send"
    ? device.createSendTransport(browserOptions)
    : device.createRecvTransport(browserOptions);
}

export function wireTransportConnection(input: {
  transport: Transport;
  request: MediaRequester;
  onState: (state: string) => void;
  onTransportState?: (direction: "send" | "recv", state: string) => void;
  getDtlsTransport: () => RTCDtlsTransport | null;
}): void {
  const { transport, request } = input;
  transport.on("connect", ({ dtlsParameters }, callback, errback) => {
    void request({
      type: "media.connectTransport",
      protocolVersion: PROTOCOL_VERSION,
      requestId: mediaRequestId(),
      transportId: transport.id,
      dtlsParameters: dtlsParameters as unknown as Record<string, unknown>,
    })
      .then((response) => expectMediaResponse(response, "media.ack"))
      .then(() => callback())
      .catch(errback);
  });
  transport.on("connectionstatechange", (state) => {
    input.onTransportState?.(transport.direction, state);
    const dtls = input.getDtlsTransport();
    const diagnostic = dtls ? ` (ICE ${dtls.iceTransport.state}; DTLS ${dtls.state})` : "";
    input.onState(`WebRTC ${transport.direction}: ${state}${diagnostic}`);
  });
}

export function wireProducerRequests(
  transport: Transport,
  request: MediaRequester,
  getHdrMetadata: () => HdrMetadata | undefined,
): void {
  transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
    const hdrMetadata = getHdrMetadata();
    void request({
      type: "media.produce",
      protocolVersion: PROTOCOL_VERSION,
      requestId: mediaRequestId(),
      transportId: transport.id,
      kind: kind as "audio" | "video",
      rtpParameters: rtpParameters as unknown as Record<string, unknown>,
      ...(kind === "video" && hdrMetadata ? { hdrMetadata } : {}),
    })
      .then((response) => expectMediaResponse(response, "media.produced"))
      .then(({ producerId }) => callback({ id: producerId }))
      .catch(errback);
  });
}

export async function applySenderPolicy(
  producer: Producer,
  contentMode: ContentMode,
): Promise<boolean> {
  const sender = producer.rtpSender;
  if (!sender) return true;
  const parameters = sender.getParameters();
  parameters.degradationPreference = degradationPreferenceForContent(contentMode);
  try {
    await sender.setParameters(parameters);
    return true;
  } catch {
    return false;
  }
}

export async function createAndResumeConsumer(input: {
  device: Device;
  producerId: string;
  request: MediaRequester;
  transport: Transport;
}): Promise<Consumer> {
  const response = expectMediaResponse(
    await input.request({
      type: "media.consume",
      protocolVersion: PROTOCOL_VERSION,
      requestId: mediaRequestId(),
      transportId: input.transport.id,
      producerId: input.producerId,
      rtpCapabilities: input.device.recvRtpCapabilities as unknown as Record<string, unknown>,
    }),
    "media.consumerCreated",
  );
  const consumer = await input.transport.consume({
    id: response.consumer.id,
    producerId: response.consumer.producerId,
    kind: response.consumer.kind,
    rtpParameters: response.consumer.rtpParameters as unknown as RtpParameters,
  });
  try {
    expectMediaResponse(
      await input.request({
        type: "media.resumeConsumer",
        protocolVersion: PROTOCOL_VERSION,
        requestId: mediaRequestId(),
        consumerId: consumer.id,
      }),
      "media.ack",
    );
    return consumer;
  } catch (error) {
    consumer.close();
    throw error;
  }
}

export function appliedProducerPolicy(input: {
  consumer: Consumer | null;
  jitterBufferTargetMs: number | null;
  producer: Producer | null;
  recvTransport: Transport | null;
  sendTransport: Transport | null;
}): Partial<StatisticsSummary> {
  const parameters = input.producer?.rtpSender?.getParameters();
  const encoding = parameters?.encodings[0];
  const transport = input.producer ? input.sendTransport : input.recvTransport;
  const dtls =
    input.producer?.rtpSender?.transport ?? input.consumer?.rtpReceiver?.transport ?? null;
  return {
    appliedMaxBitrateBps: encoding?.maxBitrate ?? null,
    appliedMaxFramerate: encoding?.maxFramerate ?? null,
    scaleResolutionDownBy: encoding?.scaleResolutionDownBy ?? null,
    degradationPreference: parameters?.degradationPreference ?? null,
    jitterBufferTargetMs: input.jitterBufferTargetMs,
    transportState: transport?.connectionState ?? null,
    iceState: dtls?.iceTransport.state ?? null,
    dtlsState: dtls?.state ?? null,
  };
}
