import {
  type ContentMode,
  type HdrMetadata,
  type MediaRequestMessage,
  type MediaResponseMessage,
  PROTOCOL_VERSION,
  type ServerMediaStatistics,
  type StatisticsSummary,
  type VideoCodec,
} from "@conference/protocol";
import type { WebRtcStatsReports } from "@conference/telemetry";
import { Device } from "mediasoup-client";
import type {
  Consumer,
  Producer,
  RtpCapabilities,
  RtpParameters,
  Transport,
  TransportOptions,
} from "mediasoup-client/types";
import { recommendH264StartupBitrateKbps } from "./h264Bitrate.js";
import { requestCodecFallback, requestConsumerKeyFrame } from "./mediaRecoveryProtocol.js";
import {
  expectMediaResponse,
  findNegotiatedCodec,
  mediaRequestId,
} from "./mediaSessionProtocol.js";
import { degradationPreferenceForContent } from "./producerPolicy.js";
import { applyAdaptiveReceiverPolicy, applyLowLatencyReceiverPolicy } from "./receiverPolicy.js";
import { displayVideoCodec } from "./videoCodecs.js";

export type MediaRequester = (message: MediaRequestMessage) => Promise<MediaResponseMessage>;

export interface ProducerSettings {
  contentMode: ContentMode;
  maxBitrateBps: number;
  maxFps: number;
  minBitrateBps: number;
  scaleResolutionDownBy?: number;
  hdrMetadata?: HdrMetadata;
  preferredCodec?: VideoCodec;
  fallbackCodec?: VideoCodec;
}

export interface MediasoupSessionCallbacks {
  onState: (state: string) => void;
  onRemoteTrack: (track: MediaStreamTrack | null) => void;
  onRemoteHdrMetadata?: (metadata: HdrMetadata | null) => void;
  onTransportState?: (direction: "send" | "recv", state: string) => void;
}

export class MediasoupSession {
  readonly #request: MediaRequester;
  readonly #callbacks: MediasoupSessionCallbacks;
  #device: Device | null = null;
  #sendTransport: Transport | null = null;
  #recvTransport: Transport | null = null;
  #producer: Producer | null = null;
  #consumer: Consumer | null = null;
  #jitterBufferTargetMs: number | null = null;
  #producerHdrMetadata: HdrMetadata | undefined;
  #producerOperations: Promise<void> = Promise.resolve();
  #consumerOperations: Promise<void> = Promise.resolve();
  #consumerTarget: { producerId: string; hdrMetadata?: HdrMetadata } | null = null;

  constructor(request: MediaRequester, callbacks: MediasoupSessionCallbacks) {
    this.#request = request;
    this.#callbacks = callbacks;
  }

  get producer(): Producer | null {
    return this.#producer;
  }

  get consumer(): Consumer | null {
    return this.#consumer;
  }

  get consumingProducerId(): string | null {
    return this.#consumer?.producerId ?? this.#consumerTarget?.producerId ?? null;
  }

  async initialize(): Promise<void> {
    if (this.#device) {
      return;
    }
    const response = expectMediaResponse(
      await this.#request({
        type: "media.getRouterCapabilities",
        protocolVersion: PROTOCOL_VERSION,
        requestId: mediaRequestId(),
      }),
      "media.routerCapabilities",
    );
    const device = await Device.factory();
    await device.load({
      routerRtpCapabilities: response.rtpCapabilities as unknown as RtpCapabilities,
    });
    const hasStage3Codec = (["video/AV1", "video/H264"] as const).some(
      (codec) =>
        Boolean(findNegotiatedCodec(device.sendRtpCapabilities.codecs, codec)) ||
        Boolean(findNegotiatedCodec(device.recvRtpCapabilities.codecs, codec)),
    );
    if (!hasStage3Codec) {
      throw new Error("This browser has no AV1 or H.264 codec compatible with the media server.");
    }
    this.#device = device;
  }

  async startProducing(
    track: MediaStreamTrack,
    settings: ProducerSettings,
    selectedCodec: VideoCodec = "video/H264",
  ): Promise<void> {
    return this.#enqueueProducer(() => this.#startProducing(track, settings, selectedCodec));
  }

  async #startProducing(
    track: MediaStreamTrack,
    settings: ProducerSettings,
    selectedCodec: VideoCodec,
  ): Promise<void> {
    await this.initialize();
    const device = this.#requiredDevice();
    if (!device.canProduce("video")) {
      throw new Error("This browser cannot produce video with the router");
    }
    if (!this.#sendTransport) {
      this.#sendTransport = await this.#createTransport("send");
      this.#wireSendTransport(this.#sendTransport);
    }
    const previousProducer = this.#producer;
    this.#producerHdrMetadata = settings.hdrMetadata;

    const codec = findNegotiatedCodec(device.sendRtpCapabilities.codecs, selectedCodec);
    if (!codec) {
      throw new Error(`${displayVideoCodec(selectedCodec)} encoding was not negotiated locally`);
    }

    const producer = await this.#sendTransport.produce({
      track,
      stopTracks: false,
      codec,
      encodings: [
        {
          maxBitrate: Math.round(settings.maxBitrateBps),
          maxFramerate: settings.maxFps,
          networkPriority: "high",
          priority: "high",
          scaleResolutionDownBy: settings.scaleResolutionDownBy ?? 1,
          ...(selectedCodec === "video/AV1" ? { scalabilityMode: "L1T1" } : {}),
        },
      ],
      codecOptions: {
        videoGoogleMinBitrate: Math.round(settings.minBitrateBps / 1_000),
        videoGoogleStartBitrate: Math.max(
          recommendH264StartupBitrateKbps(settings.maxBitrateBps),
          Math.round(settings.minBitrateBps / 1_000),
        ),
        videoGoogleMaxBitrate: Math.round(settings.maxBitrateBps / 1_000),
      },
      appData: { source: "screen" },
    });
    this.#producer = producer;
    previousProducer?.close();
    await this.#applySenderPolicy(producer, settings.contentMode);
    producer.on("transportclose", () => {
      if (this.#producer === producer) {
        this.#producer = null;
      }
    });
    this.#callbacks.onState(`${displayVideoCodec(selectedCodec)} screen producer active`);
  }

  async updateProducerSettings(settings: ProducerSettings): Promise<void> {
    return this.#enqueueProducer(() => this.#updateProducerSettings(settings));
  }

  async #updateProducerSettings(settings: ProducerSettings): Promise<void> {
    const producer = this.#producer;
    if (!producer || producer.closed) {
      return;
    }
    await producer.setRtpEncodingParameters({
      maxBitrate: Math.round(settings.maxBitrateBps),
      maxFramerate: settings.maxFps,
      scaleResolutionDownBy: settings.scaleResolutionDownBy ?? 1,
    });
    await this.#applySenderPolicy(producer, settings.contentMode);
  }

  async getStatsReports(): Promise<WebRtcStatsReports> {
    const [sender, receiver, transport] = await Promise.all([
      this.#producer?.getStats() ?? Promise.resolve(null),
      this.#consumer?.getStats() ?? Promise.resolve(null),
      (this.#sendTransport ?? this.#recvTransport)?.getStats() ?? Promise.resolve(null),
    ]);
    return { sender, receiver, transport };
  }

  async getServerStats(): Promise<ServerMediaStatistics> {
    const response = expectMediaResponse(
      await this.#request({
        type: "media.getServerStats",
        protocolVersion: PROTOCOL_VERSION,
        requestId: mediaRequestId(),
      }),
      "media.serverStats",
    );
    return response.stats;
  }

  getAppliedProducerPolicy(): Partial<StatisticsSummary> {
    const parameters = this.#producer?.rtpSender?.getParameters();
    const encoding = parameters?.encodings[0];
    const transport = this.#producer ? this.#sendTransport : this.#recvTransport;
    const dtlsTransport =
      this.#producer?.rtpSender?.transport ?? this.#consumer?.rtpReceiver?.transport ?? null;
    return {
      appliedMaxBitrateBps: encoding?.maxBitrate ?? null,
      appliedMaxFramerate: encoding?.maxFramerate ?? null,
      scaleResolutionDownBy: encoding?.scaleResolutionDownBy ?? null,
      degradationPreference: parameters?.degradationPreference ?? null,
      jitterBufferTargetMs: this.#jitterBufferTargetMs,
      transportState: transport?.connectionState ?? null,
      iceState: dtlsTransport?.iceTransport.state ?? null,
      dtlsState: dtlsTransport?.state ?? null,
    };
  }

  async stopProducing(): Promise<void> {
    return this.#enqueueProducer(() => this.#stopProducing());
  }

  async #stopProducing(): Promise<void> {
    const producer = this.#producer;
    this.#producer = null;
    if (!producer) {
      return;
    }
    if (!producer.closed) {
      try {
        expectMediaResponse(
          await this.#request({
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
    }
    this.#callbacks.onState("Screen producer stopped");
  }

  async consume(producerId: string, hdrMetadata?: HdrMetadata): Promise<void> {
    return this.#enqueueConsumer(() => this.#consume(producerId, hdrMetadata));
  }

  async requestConsumerKeyFrame(): Promise<void> {
    const consumer = this.#consumer;
    if (!consumer || consumer.closed) {
      throw new Error("No active screen receiver is available");
    }
    const policy = applyAdaptiveReceiverPolicy(consumer);
    this.#jitterBufferTargetMs = policy.jitterBufferTargetMs;
    await requestConsumerKeyFrame(this.#request, consumer.id);
  }

  async requestCodecFallback(requestedCodec: VideoCodec): Promise<void> {
    const consumer = this.#consumer;
    if (!consumer || consumer.closed) {
      throw new Error("No active screen receiver is available");
    }
    await requestCodecFallback(this.#request, consumer.id, requestedCodec);
  }

  applyLowLatencyReceiverPolicy(): boolean {
    const consumer = this.#consumer;
    if (!consumer || consumer.closed) {
      return false;
    }
    const policy = applyLowLatencyReceiverPolicy(consumer);
    this.#jitterBufferTargetMs = policy.jitterBufferTargetMs;
    return policy.accepted;
  }

  async #consume(producerId: string, hdrMetadata?: HdrMetadata): Promise<void> {
    await this.initialize();
    const device = this.#requiredDevice();
    if (!this.#recvTransport) {
      this.#recvTransport = await this.#createTransport("recv");
      this.#wireConnect(this.#recvTransport);
    }
    this.stopConsuming();
    this.#consumerTarget = { producerId, ...(hdrMetadata ? { hdrMetadata } : {}) };
    const response = expectMediaResponse(
      await this.#request({
        type: "media.consume",
        protocolVersion: PROTOCOL_VERSION,
        requestId: mediaRequestId(),
        transportId: this.#recvTransport.id,
        producerId,
        rtpCapabilities: device.recvRtpCapabilities as unknown as Record<string, unknown>,
      }),
      "media.consumerCreated",
    );
    const consumer = await this.#recvTransport.consume({
      id: response.consumer.id,
      producerId: response.consumer.producerId,
      kind: response.consumer.kind,
      rtpParameters: response.consumer.rtpParameters as unknown as RtpParameters,
    });
    try {
      const receiverPolicy = applyAdaptiveReceiverPolicy(consumer);
      this.#jitterBufferTargetMs = receiverPolicy.jitterBufferTargetMs;
      if (!receiverPolicy.accepted) {
        this.#callbacks.onState("Browser did not accept adaptive receive buffering");
      }
      expectMediaResponse(
        await this.#request({
          type: "media.resumeConsumer",
          protocolVersion: PROTOCOL_VERSION,
          requestId: mediaRequestId(),
          consumerId: consumer.id,
        }),
        "media.ack",
      );
      this.#consumer = consumer;
      this.#callbacks.onRemoteTrack(consumer.track);
      this.#callbacks.onRemoteHdrMetadata?.(hdrMetadata ?? null);
      consumer.on("transportclose", () => this.#stopConsumerIfCurrent(consumer));
      consumer.on("trackended", () => this.#stopConsumerIfCurrent(consumer));
    } catch (error) {
      consumer.close();
      throw error;
    }
    const codecMimeType = consumer.rtpParameters.codecs.find(
      (codec) => !codec.mimeType.toLowerCase().endsWith("/rtx"),
    )?.mimeType;
    this.#callbacks.onState(
      `Receiving ${codecMimeType ? codecMimeType.replace("video/", "") : "screen"} video`,
    );
  }

  stopConsuming(producerId?: string): void {
    if (producerId && this.consumingProducerId !== producerId) {
      return;
    }
    const consumer = this.#consumer;
    this.#consumer = null;
    this.#consumerTarget = null;
    this.#jitterBufferTargetMs = null;
    consumer?.close();
    this.#callbacks.onRemoteTrack(null);
    this.#callbacks.onRemoteHdrMetadata?.(null);
  }

  close(): void {
    this.#producer?.close();
    this.#consumer?.close();
    this.#sendTransport?.close();
    this.#recvTransport?.close();
    this.#producer = null;
    this.#consumer = null;
    this.#consumerTarget = null;
    this.#sendTransport = null;
    this.#recvTransport = null;
    this.#device = null;
    this.#jitterBufferTargetMs = null;
    this.#callbacks.onRemoteTrack(null);
    this.#callbacks.onRemoteHdrMetadata?.(null);
  }

  async #createTransport(direction: "send" | "recv"): Promise<Transport> {
    const device = this.#requiredDevice();
    const response = expectMediaResponse(
      await this.#request({
        type: "media.createTransport",
        protocolVersion: PROTOCOL_VERSION,
        requestId: mediaRequestId(),
        direction,
      }),
      "media.transportCreated",
    );
    const options = response.transport as unknown as TransportOptions<Record<string, unknown>>;
    const browserOptions: TransportOptions<Record<string, unknown>> = {
      ...options,
      iceTransportPolicy: "all",
      additionalSettings: {
        ...options.additionalSettings,
        iceCandidatePoolSize: 1,
      },
    };
    return direction === "send"
      ? device.createSendTransport(browserOptions)
      : device.createRecvTransport(browserOptions);
  }

  #wireSendTransport(transport: Transport): void {
    this.#wireConnect(transport);
    transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
      void this.#request({
        type: "media.produce",
        protocolVersion: PROTOCOL_VERSION,
        requestId: mediaRequestId(),
        transportId: transport.id,
        kind: kind as "video",
        rtpParameters: rtpParameters as unknown as Record<string, unknown>,
        ...(this.#producerHdrMetadata ? { hdrMetadata: this.#producerHdrMetadata } : {}),
      })
        .then((response) => expectMediaResponse(response, "media.produced"))
        .then(({ producerId }) => callback({ id: producerId }))
        .catch(errback);
    });
  }

  #wireConnect(transport: Transport): void {
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      void this.#request({
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
      this.#callbacks.onTransportState?.(transport.direction, state);
      const dtlsTransport =
        transport.direction === "send"
          ? (this.#producer?.rtpSender?.transport ?? null)
          : (this.#consumer?.rtpReceiver?.transport ?? null);
      const diagnostic = dtlsTransport
        ? ` (ICE ${dtlsTransport.iceTransport.state}; DTLS ${dtlsTransport.state})`
        : "";
      this.#callbacks.onState(`WebRTC ${transport.direction}: ${state}${diagnostic}`);
    });
  }

  async #applySenderPolicy(producer: Producer, contentMode: ContentMode): Promise<void> {
    const sender = producer.rtpSender;
    if (!sender) {
      return;
    }
    const parameters = sender.getParameters();
    const degradationPreference = degradationPreferenceForContent(contentMode);
    parameters.degradationPreference = degradationPreference;
    try {
      await sender.setParameters(parameters);
    } catch {
      this.#callbacks.onState(`Browser did not accept ${degradationPreference} preference`);
    }
  }

  #stopConsumerIfCurrent(consumer: Consumer): void {
    if (this.#consumer === consumer) {
      this.stopConsuming(consumer.producerId);
    }
  }

  #enqueueProducer<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#producerOperations.then(operation, operation);
    this.#producerOperations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #enqueueConsumer<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#consumerOperations.then(operation, operation);
    this.#consumerOperations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #requiredDevice(): Device {
    if (!this.#device) {
      throw new Error("mediasoup device is not initialized");
    }
    return this.#device;
  }
}
