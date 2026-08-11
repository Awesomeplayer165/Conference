import {
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
import { displayVideoCodec } from "./videoCodecs.js";

export type MediaRequester = (message: MediaRequestMessage) => Promise<MediaResponseMessage>;

export interface ProducerSettings {
  maxBitrateBps: number;
  maxFps: number;
}

export interface MediasoupSessionCallbacks {
  onState: (state: string) => void;
  onRemoteTrack: (track: MediaStreamTrack | null) => void;
  onTransportState?: (direction: "send" | "recv", state: string) => void;
}

function requestId(): string {
  return crypto.randomUUID();
}

function expectResponse<T extends MediaResponseMessage["type"]>(
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

function findCodec(codecs: RtpCapabilities["codecs"], selectedCodec: VideoCodec) {
  return codecs?.find(
    (codec) =>
      codec.mimeType.toLowerCase() === selectedCodec.toLowerCase() &&
      (selectedCodec !== "video/H264" || codec.parameters?.["packetization-mode"] === 1),
  );
}

export class MediasoupSession {
  readonly #request: MediaRequester;
  readonly #callbacks: MediasoupSessionCallbacks;
  #device: Device | null = null;
  #sendTransport: Transport | null = null;
  #recvTransport: Transport | null = null;
  #producer: Producer | null = null;
  #consumer: Consumer | null = null;

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

  async initialize(): Promise<void> {
    if (this.#device) {
      return;
    }
    const response = expectResponse(
      await this.#request({
        type: "media.getRouterCapabilities",
        protocolVersion: PROTOCOL_VERSION,
        requestId: requestId(),
      }),
      "media.routerCapabilities",
    );
    const device = await Device.factory();
    await device.load({
      routerRtpCapabilities: response.rtpCapabilities as unknown as RtpCapabilities,
    });
    const hasStage3Codec = (["video/AV1", "video/H264"] as const).some(
      (codec) =>
        Boolean(findCodec(device.sendRtpCapabilities.codecs, codec)) ||
        Boolean(findCodec(device.recvRtpCapabilities.codecs, codec)),
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
    await this.initialize();
    const device = this.#requiredDevice();
    if (!device.canProduce("video")) {
      throw new Error("This browser cannot produce video with the router");
    }
    if (!this.#sendTransport) {
      this.#sendTransport = await this.#createTransport("send");
      this.#wireSendTransport(this.#sendTransport);
    }
    this.#producer?.close();

    const codec = findCodec(device.sendRtpCapabilities.codecs, selectedCodec);
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
          scaleResolutionDownBy: 1,
          ...(selectedCodec === "video/AV1" ? { scalabilityMode: "L1T1" } : {}),
        },
      ],
      codecOptions: {
        videoGoogleStartBitrate: recommendH264StartupBitrateKbps(settings.maxBitrateBps),
        videoGoogleMaxBitrate: Math.round(settings.maxBitrateBps / 1_000),
      },
      appData: { source: "screen" },
    });
    this.#producer = producer;
    await this.#applySenderPolicy(producer);
    producer.on("transportclose", () => {
      if (this.#producer === producer) {
        this.#producer = null;
      }
    });
    this.#callbacks.onState(`${displayVideoCodec(selectedCodec)} screen producer active`);
  }

  async updateProducerSettings(settings: ProducerSettings): Promise<void> {
    const producer = this.#producer;
    if (!producer || producer.closed) {
      return;
    }
    await producer.setRtpEncodingParameters({
      maxBitrate: Math.round(settings.maxBitrateBps),
      maxFramerate: settings.maxFps,
      scaleResolutionDownBy: 1,
    });
    await this.#applySenderPolicy(producer);
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
    const response = expectResponse(
      await this.#request({
        type: "media.getServerStats",
        protocolVersion: PROTOCOL_VERSION,
        requestId: requestId(),
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
      transportState: transport?.connectionState ?? null,
      iceState: dtlsTransport?.iceTransport.state ?? null,
      dtlsState: dtlsTransport?.state ?? null,
    };
  }

  async stopProducing(): Promise<void> {
    const producer = this.#producer;
    this.#producer = null;
    if (!producer) {
      return;
    }
    if (!producer.closed) {
      try {
        expectResponse(
          await this.#request({
            type: "media.closeProducer",
            protocolVersion: PROTOCOL_VERSION,
            requestId: requestId(),
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

  async consume(producerId: string): Promise<void> {
    await this.initialize();
    const device = this.#requiredDevice();
    if (!this.#recvTransport) {
      this.#recvTransport = await this.#createTransport("recv");
      this.#wireRecvTransport(this.#recvTransport);
    }
    this.stopConsuming();
    const response = expectResponse(
      await this.#request({
        type: "media.consume",
        protocolVersion: PROTOCOL_VERSION,
        requestId: requestId(),
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
    this.#consumer = consumer;
    this.#callbacks.onRemoteTrack(consumer.track);
    consumer.on("transportclose", () => this.stopConsuming());
    consumer.on("trackended", () => this.stopConsuming());
    expectResponse(
      await this.#request({
        type: "media.resumeConsumer",
        protocolVersion: PROTOCOL_VERSION,
        requestId: requestId(),
        consumerId: consumer.id,
      }),
      "media.ack",
    );
    const codecMimeType = consumer.rtpParameters.codecs.find(
      (codec) => !codec.mimeType.toLowerCase().endsWith("/rtx"),
    )?.mimeType;
    this.#callbacks.onState(
      `Receiving ${codecMimeType ? codecMimeType.replace("video/", "") : "screen"} video`,
    );
  }

  stopConsuming(): void {
    const consumer = this.#consumer;
    this.#consumer = null;
    consumer?.close();
    this.#callbacks.onRemoteTrack(null);
  }

  close(): void {
    this.#producer?.close();
    this.#consumer?.close();
    this.#sendTransport?.close();
    this.#recvTransport?.close();
    this.#producer = null;
    this.#consumer = null;
    this.#sendTransport = null;
    this.#recvTransport = null;
    this.#device = null;
    this.#callbacks.onRemoteTrack(null);
  }

  async #createTransport(direction: "send" | "recv"): Promise<Transport> {
    const device = this.#requiredDevice();
    const response = expectResponse(
      await this.#request({
        type: "media.createTransport",
        protocolVersion: PROTOCOL_VERSION,
        requestId: requestId(),
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
        requestId: requestId(),
        transportId: transport.id,
        kind: kind as "video",
        rtpParameters: rtpParameters as unknown as Record<string, unknown>,
      })
        .then((response) => expectResponse(response, "media.produced"))
        .then(({ producerId }) => callback({ id: producerId }))
        .catch(errback);
    });
  }

  #wireRecvTransport(transport: Transport): void {
    this.#wireConnect(transport);
  }

  #wireConnect(transport: Transport): void {
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      void this.#request({
        type: "media.connectTransport",
        protocolVersion: PROTOCOL_VERSION,
        requestId: requestId(),
        transportId: transport.id,
        dtlsParameters: dtlsParameters as unknown as Record<string, unknown>,
      })
        .then((response) => expectResponse(response, "media.ack"))
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

  async #applySenderPolicy(producer: Producer): Promise<void> {
    const sender = producer.rtpSender;
    if (!sender) {
      return;
    }
    const parameters = sender.getParameters();
    parameters.degradationPreference = "maintain-resolution";
    try {
      await sender.setParameters(parameters);
    } catch {
      this.#callbacks.onState("Browser did not accept maintain-resolution preference");
    }
  }

  #requiredDevice(): Device {
    if (!this.#device) {
      throw new Error("mediasoup device is not initialized");
    }
    return this.#device;
  }
}
