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
import type { Consumer, Producer, RtpCapabilities, Transport } from "mediasoup-client/types";
import { closeRemoteProducers, produceDisplayAudio } from "./displayAudio.js";
import { recommendH264StartupBitrateKbps } from "./h264Bitrate.js";
import { requestCodecFallback, requestConsumerKeyFrame } from "./mediaRecoveryProtocol.js";
import {
  expectMediaResponse,
  findNegotiatedCodec,
  mediaRequestId,
} from "./mediaSessionProtocol.js";
import { createProducerEncoding } from "./producerPolicy.js";
import { applyAdaptiveReceiverPolicy, applyLowLatencyReceiverPolicy } from "./receiverPolicy.js";
import {
  appliedProducerPolicy,
  applySenderPolicy,
  createAndResumeConsumer,
  createSessionTransport,
  wireProducerRequests,
  wireTransportConnection,
} from "./sessionTransport.js";
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
  onRemoteAudioTrack?: (track: MediaStreamTrack | null) => void;
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
  #audioProducer: Producer | null = null;
  #consumer: Consumer | null = null;
  #audioConsumer: Consumer | null = null;
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

  isConsumingProducer(producerId: string): boolean {
    return (
      this.consumingProducerId === producerId || this.#audioConsumer?.producerId === producerId
    );
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
    audioTrack?: MediaStreamTrack | null,
  ): Promise<void> {
    return this.#enqueueProducer(async () => {
      await this.#startProducing(track, settings, selectedCodec);
      if (audioTrack) {
        await this.#startAudioProducing(audioTrack);
      }
    });
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
      this.#sendTransport = await createSessionTransport(device, this.#request, "send");
      this.#configureTransport(this.#sendTransport);
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
      encodings: [createProducerEncoding(settings)],
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
    if (!(await applySenderPolicy(producer, settings.contentMode))) {
      this.#callbacks.onState("Browser did not accept the motion-first sender policy");
    }
    producer.on("transportclose", () => {
      if (this.#producer === producer) {
        this.#producer = null;
      }
    });
    this.#callbacks.onState(`${displayVideoCodec(selectedCodec)} screen producer active`);
  }

  async #startAudioProducing(track: MediaStreamTrack): Promise<void> {
    const device = this.#requiredDevice();
    if (!device.canProduce("audio") || !this.#sendTransport) {
      this.#callbacks.onState("Display audio is unavailable for this browser or media server");
      return;
    }
    if (this.#audioProducer?.track?.id === track.id && !this.#audioProducer.closed) {
      return;
    }
    const previous = this.#audioProducer;
    const producer = await produceDisplayAudio(this.#sendTransport, track);
    this.#audioProducer = producer;
    previous?.close();
    producer.on("transportclose", () => {
      if (this.#audioProducer === producer) this.#audioProducer = null;
    });
    this.#callbacks.onState("Screen video and display audio active");
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
    if (!(await applySenderPolicy(producer, settings.contentMode))) {
      this.#callbacks.onState("Browser did not accept the motion-first sender policy");
    }
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
    return appliedProducerPolicy({
      consumer: this.#consumer,
      jitterBufferTargetMs: this.#jitterBufferTargetMs,
      producer: this.#producer,
      recvTransport: this.#recvTransport,
      sendTransport: this.#sendTransport,
    });
  }

  async stopProducing(): Promise<void> {
    return this.#enqueueProducer(() => this.#stopProducing());
  }

  async #stopProducing(): Promise<void> {
    const producer = this.#producer;
    const audioProducer = this.#audioProducer;
    this.#producer = null;
    this.#audioProducer = null;
    if (!producer && !audioProducer) {
      return;
    }
    await closeRemoteProducers([producer, audioProducer], this.#request);
    this.#callbacks.onState("Screen producer stopped");
  }

  async consume(
    producerId: string,
    kind: "audio" | "video" = "video",
    hdrMetadata?: HdrMetadata,
  ): Promise<void> {
    return this.#enqueueConsumer(() => this.#consume(producerId, kind, hdrMetadata));
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

  async #consume(
    producerId: string,
    kind: "audio" | "video",
    hdrMetadata?: HdrMetadata,
  ): Promise<void> {
    await this.initialize();
    const device = this.#requiredDevice();
    if (!this.#recvTransport) {
      this.#recvTransport = await createSessionTransport(device, this.#request, "recv");
      this.#configureTransport(this.#recvTransport);
    }
    const replacedProducerId =
      kind === "video" ? this.consumingProducerId : this.#audioConsumer?.producerId;
    if (replacedProducerId) {
      this.stopConsuming(replacedProducerId);
    }
    if (kind === "video") {
      this.#consumerTarget = {
        producerId,
        ...(hdrMetadata ? { hdrMetadata } : {}),
      };
    }
    const consumer = await createAndResumeConsumer({
      device,
      producerId,
      request: this.#request,
      transport: this.#recvTransport,
    });
    try {
      if (kind === "video") {
        const receiverPolicy = applyAdaptiveReceiverPolicy(consumer);
        this.#jitterBufferTargetMs = receiverPolicy.jitterBufferTargetMs;
        if (!receiverPolicy.accepted) {
          this.#callbacks.onState("Browser did not accept adaptive receive buffering");
        }
      }
      if (kind === "video") {
        this.#consumer = consumer;
        this.#callbacks.onRemoteTrack(consumer.track);
        this.#callbacks.onRemoteHdrMetadata?.(hdrMetadata ?? null);
      } else {
        this.#audioConsumer = consumer;
        this.#callbacks.onRemoteAudioTrack?.(consumer.track);
      }
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
      kind === "audio"
        ? "Receiving display audio"
        : `Receiving ${codecMimeType ? codecMimeType.replace("video/", "") : "screen"} video`,
    );
  }

  stopConsuming(producerId?: string): void {
    const closeVideo = !producerId || this.consumingProducerId === producerId;
    const closeAudio = !producerId || this.#audioConsumer?.producerId === producerId;
    if (closeVideo) {
      const consumer = this.#consumer;
      this.#consumer = null;
      this.#consumerTarget = null;
      this.#jitterBufferTargetMs = null;
      consumer?.close();
      this.#callbacks.onRemoteTrack(null);
      this.#callbacks.onRemoteHdrMetadata?.(null);
    }
    if (closeAudio) {
      this.#audioConsumer?.close();
      this.#audioConsumer = null;
      this.#callbacks.onRemoteAudioTrack?.(null);
    }
  }

  close(): void {
    this.#producer?.close();
    this.#audioProducer?.close();
    this.#consumer?.close();
    this.#audioConsumer?.close();
    this.#sendTransport?.close();
    this.#recvTransport?.close();
    this.#producer = null;
    this.#audioProducer = null;
    this.#consumer = null;
    this.#audioConsumer = null;
    this.#consumerTarget = null;
    this.#sendTransport = null;
    this.#recvTransport = null;
    this.#device = null;
    this.#jitterBufferTargetMs = null;
    this.#callbacks.onRemoteTrack(null);
    this.#callbacks.onRemoteAudioTrack?.(null);
    this.#callbacks.onRemoteHdrMetadata?.(null);
  }

  #configureTransport(transport: Transport): void {
    wireTransportConnection({
      transport,
      request: this.#request,
      onState: this.#callbacks.onState,
      ...(this.#callbacks.onTransportState
        ? { onTransportState: this.#callbacks.onTransportState }
        : {}),
      getDtlsTransport: () =>
        transport.direction === "send"
          ? (this.#producer?.rtpSender?.transport ?? null)
          : (this.#consumer?.rtpReceiver?.transport ?? null),
    });
    if (transport.direction === "send") {
      wireProducerRequests(transport, this.#request, () => this.#producerHdrMetadata);
    }
  }

  #stopConsumerIfCurrent(consumer: Consumer): void {
    if (this.#consumer === consumer || this.#audioConsumer === consumer) {
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
