import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import { type ServerMediaStatistics, ServerMediaStatisticsSchema } from "@conference/protocol";
import * as mediasoup from "mediasoup";
import type {
  Consumer,
  DtlsParameters,
  Producer,
  Router,
  RtpCapabilities,
  RtpParameters,
  WebRtcTransport,
  Worker,
} from "mediasoup/types";

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

type NetworkInterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

function isPrivateOrSharedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 100 && (octets[1] ?? 0) >= 64 && (octets[1] ?? 0) <= 127)
  );
}

export function defaultMediasoupListenIps(
  interfaces: NetworkInterfaceMap = networkInterfaces(),
): string[] {
  const privateAddresses = Object.entries(interfaces)
    .flatMap(([name, entries]) =>
      (entries ?? []).map((entry) => ({
        entry,
        virtual: /^(bridge|utun|awdl|llw|docker|veth|lo)/i.test(name),
      })),
    )
    .filter(
      ({ entry, virtual }) =>
        !entry.internal &&
        entry.family === "IPv4" &&
        isPrivateOrSharedIpv4(entry.address) &&
        (!virtual || entry.address.startsWith("100.")),
    )
    .map(({ entry }) => entry.address);
  return [...new Set([...privateAddresses, "127.0.0.1"])];
}

export function parseMediasoupPortRange(
  minimum: string | undefined,
  maximum: string | undefined,
): { min: number; max: number } | undefined {
  if (minimum === undefined && maximum === undefined) {
    return undefined;
  }
  const min = Number(minimum);
  const max = Number(maximum);
  if (
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 1_024 ||
    max > 65_535 ||
    min > max
  ) {
    throw new Error(
      "MEDIASOUP_MIN_PORT and MEDIASOUP_MAX_PORT must define an ordered 1024-65535 range",
    );
  }
  return { min, max };
}

function mediasoupListenAddresses(): Array<{ ip: string; announcedAddress?: string }> {
  const configuredIp = process.env.MEDIASOUP_LISTEN_IP;
  const announcedAddress = process.env.MEDIASOUP_ANNOUNCED_ADDRESS;
  if (!configuredIp) {
    if (announcedAddress) {
      throw new Error(
        "MEDIASOUP_ANNOUNCED_ADDRESS requires MEDIASOUP_LISTEN_IP to identify its bind address",
      );
    }
    return defaultMediasoupListenIps().map((ip) => ({ ip }));
  }
  if ((configuredIp === "0.0.0.0" || configuredIp === "::") && !announcedAddress) {
    throw new Error(
      "A wildcard MEDIASOUP_LISTEN_IP requires MEDIASOUP_ANNOUNCED_ADDRESS for usable ICE candidates",
    );
  }
  return [
    {
      ip: configuredIp,
      ...(announcedAddress ? { announcedAddress } : {}),
    },
  ];
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
  readonly #transports = new Map<string, MediaResource<WebRtcTransport<TransportAppData>>>();
  readonly #producers = new Map<string, MediaResource<Producer>>();
  readonly #consumers = new Map<string, MediaResource<Consumer>>();

  private constructor(worker: Worker, router: Router) {
    this.#worker = worker;
    this.#router = router;
  }

  static async create(): Promise<MediaService> {
    const worker = await mediasoup.createWorker({
      logLevel: "warn",
      logTags: ["ice", "dtls", "rtp", "rtcp", "bwe"],
    });
    worker.once("died", (error) => {
      console.error("[sfu] mediasoup worker died", error);
    });
    const router = await worker.createRouter({
      mediaCodecs: ROUTER_MEDIA_CODECS,
    });
    return new MediaService(worker, router);
  }

  get routerRtpCapabilities(): RtpCapabilities {
    return this.#router.rtpCapabilities;
  }

  async createTransport(
    endpointId: string,
    direction: TransportDirection,
  ): Promise<CreatedTransport> {
    const addresses = mediasoupListenAddresses();
    const portRange = parseMediasoupPortRange(
      process.env.MEDIASOUP_MIN_PORT,
      process.env.MEDIASOUP_MAX_PORT,
    );
    const transport = await this.#router.createWebRtcTransport<TransportAppData>({
      listenInfos: addresses.flatMap((address) => [
        { protocol: "udp" as const, ...address, ...(portRange ? { portRange } : {}) },
        { protocol: "tcp" as const, ...address, ...(portRange ? { portRange } : {}) },
      ]),
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
