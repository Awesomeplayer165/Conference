import { type ServerMediaStatistics, ServerMediaStatisticsSchema } from "@conference/protocol";
import * as mediasoup from "mediasoup";
import type {
  Consumer,
  DtlsParameters,
  Producer,
  Router,
  RtpCapabilities,
  RtpParameters,
  WebRtcServer,
  WebRtcTransport,
  Worker,
} from "mediasoup/types";
import { mediasoupWebRtcServerConfig } from "./mediaConfig.js";

export type TransportDirection = "send" | "recv";

interface TransportAppData {
  [key: string]: unknown;
  endpointId: string;
  direction: TransportDirection;
}

interface MediaResource<T> {
  endpointId: string;
  value: T;
}

export interface CreatedTransport {
  id: string;
  iceParameters: WebRtcTransport["iceParameters"];
  iceCandidates: WebRtcTransport["iceCandidates"];
  dtlsParameters: WebRtcTransport["dtlsParameters"];
  sctpParameters: null;
}

export interface CreatedConsumer {
  id: string;
  producerId: string;
  kind: "video";
  rtpParameters: RtpParameters;
}

const VIDEO_RTCP_FEEDBACK = [
  { type: "nack" },
  { type: "nack", parameter: "pli" },
  { type: "ccm", parameter: "fir" },
  { type: "goog-remb" },
  { type: "transport-cc" },
];

const ROUTER_MEDIA_CODECS = [
  {
    kind: "video" as const,
    mimeType: "video/AV1",
    clockRate: 90_000,
    parameters: {},
    rtcpFeedback: VIDEO_RTCP_FEEDBACK,
  },
  {
    kind: "video" as const,
    mimeType: "video/H264",
    clockRate: 90_000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
    },
    rtcpFeedback: VIDEO_RTCP_FEEDBACK,
  },
];

export function fractionLostToPercent(fractionLost: number | null): number | null {
  return fractionLost === null ? null : (fractionLost / 256) * 100;
}

export class MediaService {
  readonly #worker: Worker;
  readonly #router: Router;
  readonly #webRtcServer: WebRtcServer;
  readonly #transports = new Map<string, MediaResource<WebRtcTransport<TransportAppData>>>();
  readonly #producers = new Map<string, MediaResource<Producer>>();
  readonly #consumers = new Map<string, MediaResource<Consumer>>();

  private constructor(worker: Worker, router: Router, webRtcServer: WebRtcServer) {
    this.#worker = worker;
    this.#router = router;
    this.#webRtcServer = webRtcServer;
  }

  static async create(): Promise<MediaService> {
    const worker = await mediasoup.createWorker({
      logLevel: "warn",
      logTags: ["ice", "dtls", "rtp", "rtcp", "bwe"],
    });
    worker.once("died", (error) => {
      console.error("[sfu] mediasoup worker died", error);
    });
    try {
      const router = await worker.createRouter({
        mediaCodecs: ROUTER_MEDIA_CODECS,
      });
      const configuration = mediasoupWebRtcServerConfig();
      const webRtcServer = await worker.createWebRtcServer({
        listenInfos: configuration.listenInfos,
      });
      console.info(
        `[sfu] Shared WebRTC server ready on UDP/TCP port ${configuration.port} (${configuration.listenInfos.length} candidates)`,
      );
      return new MediaService(worker, router, webRtcServer);
    } catch (error) {
      worker.close();
      throw error;
    }
  }

  get routerRtpCapabilities(): RtpCapabilities {
    return this.#router.rtpCapabilities;
  }

  async createTransport(
    endpointId: string,
    direction: TransportDirection,
  ): Promise<CreatedTransport> {
    const transport = await this.#router.createWebRtcTransport<TransportAppData>({
      webRtcServer: this.#webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 100_000_000,
      enableSctp: false,
      appData: { endpointId, direction },
    });
    this.#transports.set(transport.id, { endpointId, value: transport });
    transport.observer.once("close", () => {
      this.#transports.delete(transport.id);
    });
    transport.on("icestatechange", (state) => {
      console.info(`[sfu] ${direction} transport ${transport.id} ICE ${state}`);
    });
    transport.on("dtlsstatechange", (state) => {
      console.info(`[sfu] ${direction} transport ${transport.id} DTLS ${state}`);
    });
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: null,
    };
  }

  async connectTransport(
    endpointId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<void> {
    const transport = this.#ownedTransport(endpointId, transportId);
    await transport.connect({ dtlsParameters });
  }

  async produce(
    endpointId: string,
    transportId: string,
    rtpParameters: RtpParameters,
  ): Promise<Producer> {
    const transport = this.#ownedTransport(endpointId, transportId);
    if (transport.appData.direction !== "send") {
      throw new Error("Cannot produce on a receive transport");
    }
    const producer = await transport.produce({
      kind: "video",
      rtpParameters,
      appData: { endpointId, source: "screen" },
    });
    this.#producers.set(producer.id, { endpointId, value: producer });
    producer.observer.once("close", () => {
      this.#producers.delete(producer.id);
    });
    return producer;
  }

  async consume(
    endpointId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<CreatedConsumer> {
    const transport = this.#ownedTransport(endpointId, transportId);
    if (transport.appData.direction !== "recv") {
      throw new Error("Cannot consume on a send transport");
    }
    if (!this.#router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error("CANNOT_CONSUME");
    }
    for (const resource of this.#consumers.values()) {
      if (resource.endpointId === endpointId) {
        resource.value.close();
      }
    }
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
      enableRtx: true,
      appData: { endpointId, source: "screen" },
    });
    this.#consumers.set(consumer.id, { endpointId, value: consumer });
    consumer.observer.once("close", () => {
      this.#consumers.delete(consumer.id);
    });
    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: "video",
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(endpointId: string, consumerId: string): Promise<void> {
    const resource = this.#consumers.get(consumerId);
    if (!resource || resource.endpointId !== endpointId) {
      throw new Error("Consumer not found");
    }
    await resource.value.resume();
    await resource.value.requestKeyFrame();
  }

  async getEndpointStats(endpointId: string): Promise<ServerMediaStatistics> {
    const producer = [...this.#producers.values()].find(
      (resource) => resource.endpointId === endpointId,
    )?.value;
    const consumer = [...this.#consumers.values()].find(
      (resource) => resource.endpointId === endpointId,
    )?.value;
    const transport = [...this.#transports.values()].find(
      (resource) =>
        resource.endpointId === endpointId &&
        resource.value.appData.direction === (producer ? "send" : "recv"),
    )?.value;
    const [stats, transportStats] = await Promise.all([
      producer
        ? producer.getStats().then((values) => values[0])
        : consumer
          ? consumer.getStats().then((values) => values[0])
          : Promise.resolve(undefined),
      transport?.getStats().then((values) => values[0]),
    ]);
    if (!stats && !transportStats) {
      return ServerMediaStatisticsSchema.parse({
        bitrateBps: null,
        availableBitrateBps: null,
        rttMs: null,
        packetLossPercent: null,
        packetsLost: null,
        packetsRetransmitted: null,
        nackCount: null,
        pliCount: null,
        firCount: null,
        score: null,
        iceState: null,
        dtlsState: null,
        transportProtocol: null,
      });
    }
    const hasMediaPackets = stats ? stats.packetCount + stats.packetsLost > 0 : false;
    const lossFraction =
      stats && hasMediaPackets && typeof stats.fractionLost === "number"
        ? stats.fractionLost
        : null;
    const transportBitrate = producer
      ? transportStats?.rtpRecvBitrate
      : transportStats?.rtpSendBitrate;
    const availableBitrate = producer
      ? transportStats?.availableIncomingBitrate
      : transportStats?.availableOutgoingBitrate;
    return ServerMediaStatisticsSchema.parse({
      bitrateBps: stats?.bitrate ?? transportBitrate ?? null,
      availableBitrateBps: availableBitrate ?? null,
      rttMs: stats?.roundTripTime ?? null,
      packetLossPercent: fractionLostToPercent(lossFraction),
      packetsLost: stats && hasMediaPackets ? stats.packetsLost : null,
      packetsRetransmitted: stats?.packetsRetransmitted ?? null,
      nackCount: stats?.nackCount ?? null,
      pliCount: stats?.pliCount ?? null,
      firCount: stats?.firCount ?? null,
      score: stats?.score ?? null,
      iceState: transportStats?.iceState ?? null,
      dtlsState: transportStats?.dtlsState ?? null,
      transportProtocol: transportStats?.iceSelectedTuple?.protocol ?? null,
    });
  }

  closeProducer(endpointId: string, producerId: string): void {
    const resource = this.#producers.get(producerId);
    if (!resource || resource.endpointId !== endpointId) {
      throw new Error("Producer not found");
    }
    resource.value.close();
  }

  closeEndpoint(endpointId: string): void {
    for (const resource of this.#consumers.values()) {
      if (resource.endpointId === endpointId) {
        resource.value.close();
      }
    }
    for (const resource of this.#producers.values()) {
      if (resource.endpointId === endpointId) {
        resource.value.close();
      }
    }
    for (const resource of this.#transports.values()) {
      if (resource.endpointId === endpointId) {
        resource.value.close();
      }
    }
  }

  close(): void {
    this.#webRtcServer.close();
    this.#worker.close();
  }

  #ownedTransport(endpointId: string, transportId: string): WebRtcTransport<TransportAppData> {
    const resource = this.#transports.get(transportId);
    if (!resource || resource.endpointId !== endpointId) {
      throw new Error("Transport not found");
    }
    return resource.value;
  }
}
