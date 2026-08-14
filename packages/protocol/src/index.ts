import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const RoleSchema = z.enum(["host", "viewer"]);
export type Role = z.infer<typeof RoleSchema>;

export const ContentModeSchema = z.enum(["auto", "detail", "motion"]);
export type ContentMode = z.infer<typeof ContentModeSchema>;

export const VideoCodecSchema = z.enum(["video/AV1", "video/H265", "video/H264"]);
export type VideoCodec = z.infer<typeof VideoCodecSchema>;

export const VideoCodecCapabilitiesSchema = z.object({
  send: z.array(VideoCodecSchema).max(3),
  receive: z.array(VideoCodecSchema).max(3),
});
export type VideoCodecCapabilities = z.infer<typeof VideoCodecCapabilitiesSchema>;

export const HdrModeSchema = z.enum(["unknown", "sdr", "hdr-pq", "hdr-hlg"]);
export type HdrMode = z.infer<typeof HdrModeSchema>;

export const HdrMetadataSchema = z.object({
  mode: HdrModeSchema,
  primaries: z.string().nullable(),
  transfer: z.string().nullable(),
  matrix: z.string().nullable(),
  fullRange: z.boolean().nullable(),
  detectionSource: z.enum(["track-settings", "video-frame", "unknown"]),
  passthroughRequested: z.boolean(),
});
export type HdrMetadata = z.infer<typeof HdrMetadataSchema>;

export const BrowserInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  os: z.string().min(1),
});
export type BrowserInfo = z.infer<typeof BrowserInfoSchema>;

const nullableMetric = z.number().finite().nullable();

export const StatisticsSummarySchema = z.object({
  codec: z.string().nullable(),
  sourceWidth: nullableMetric,
  sourceHeight: nullableMetric,
  encodedWidth: nullableMetric,
  encodedHeight: nullableMetric,
  decodedWidth: nullableMetric,
  decodedHeight: nullableMetric,
  renderWidth: nullableMetric,
  renderHeight: nullableMetric,
  captureFps: nullableMetric,
  previewFps: nullableMetric,
  encodeFps: nullableMetric,
  decodeFps: nullableMetric,
  presentationFps: nullableMetric,
  encoderTargetBitrateBps: nullableMetric,
  targetBitrateBps: nullableMetric,
  actualBitrateBps: nullableMetric,
  availableOutgoingBitrateBps: nullableMetric,
  framesEncoded: nullableMetric,
  framesDecoded: nullableMetric,
  keyFramesEncoded: nullableMetric,
  keyFramesDecoded: nullableMetric,
  packetSendDelayMsPerPacket: nullableMetric,
  rttMs: nullableMetric,
  minRttMs: nullableMetric,
  rttTrendMs: nullableMetric,
  jitterMs: nullableMetric,
  jitterBufferDelayMs: nullableMetric,
  jitterBufferTargetMs: nullableMetric,
  packetLossPercent: nullableMetric,
  packetsLost: nullableMetric,
  nackCount: nullableMetric,
  retransmittedPackets: nullableMetric,
  pliCount: nullableMetric,
  firCount: nullableMetric,
  qpAverage: nullableMetric,
  encodeTimeMsPerFrame: nullableMetric,
  decodeTimeMsPerFrame: nullableMetric,
  droppedFrames: nullableMetric,
  freezeCount: nullableMetric,
  freezeDurationMs: nullableMetric,
  frameCadenceDeviationMs: nullableMetric,
  estimatedLatencyMs: nullableMetric,
  latencyP50Ms: nullableMetric,
  latencyP95Ms: nullableMetric,
  latencyP99Ms: nullableMetric,
  clockOffsetMs: nullableMetric,
  clockProbeRttMs: nullableMetric,
  qualityLimitationReason: z.string().nullable(),
  encoderImplementation: z.string().nullable(),
  decoderImplementation: z.string().nullable(),
  hdrMode: z.string().nullable(),
  hdrStatus: z.string().nullable(),
  displayHdrSupported: z.boolean().nullable(),
  h264ProfileLevelId: z.string().nullable(),
  requiredH264Level: z.string().nullable(),
  encoderCapabilitySupported: z.boolean().nullable(),
  encoderCapabilitySmooth: z.boolean().nullable(),
  encoderCapabilityPowerEfficient: z.boolean().nullable(),
  appliedMaxBitrateBps: nullableMetric,
  appliedMaxFramerate: nullableMetric,
  scaleResolutionDownBy: nullableMetric,
  degradationPreference: z.string().nullable(),
  mediaFlowState: z.string().nullable(),
  transportState: z.string().nullable(),
  iceState: z.string().nullable(),
  dtlsState: z.string().nullable(),
  candidatePairState: z.string().nullable(),
  localCandidateCount: nullableMetric,
  remoteCandidateCount: nullableMetric,
  candidatePairCount: nullableMetric,
  transportProtocol: z.string().nullable(),
  serverBitrateBps: nullableMetric,
  serverAvailableBitrateBps: nullableMetric,
  serverRttMs: nullableMetric,
  serverPacketLossPercent: nullableMetric,
  serverScore: nullableMetric,
  serverIceState: z.string().nullable(),
  serverDtlsState: z.string().nullable(),
  serverTransportProtocol: z.string().nullable(),
  controllerState: z.string().nullable(),
});
export type StatisticsSummary = z.infer<typeof StatisticsSummarySchema>;

export const ServerMediaStatisticsSchema = z.object({
  bitrateBps: nullableMetric,
  rttMs: nullableMetric,
  packetLossPercent: nullableMetric,
  packetsLost: nullableMetric,
  packetsRetransmitted: nullableMetric,
  nackCount: nullableMetric,
  pliCount: nullableMetric,
  firCount: nullableMetric,
  score: nullableMetric,
  availableBitrateBps: nullableMetric,
  iceState: z.string().nullable(),
  dtlsState: z.string().nullable(),
  transportProtocol: z.string().nullable(),
});
export type ServerMediaStatistics = z.infer<typeof ServerMediaStatisticsSchema>;

export const TelemetryEnvelopeSchema = z.object({
  schemaVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  endpointId: z.string().min(1),
  role: RoleSchema,
  wallTime: z.string().datetime(),
  monotonicTime: z.number().finite().nonnegative(),
  sequence: z.number().int().nonnegative(),
  kind: z.enum(["sample", "event"]),
  browser: BrowserInfoSchema.optional(),
  presence: z.record(z.string(), z.boolean()).optional(),
  payload: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
});
export type TelemetryEnvelope = z.infer<typeof TelemetryEnvelopeSchema>;

const protocolVersion = z.literal(PROTOCOL_VERSION);
const roomId = z.string().trim().min(1).max(64);
const endpointId = z.string().trim().min(1).max(128);
const requestId = z.string().trim().min(1).max(128);
const looseObject = z.record(z.string(), z.unknown());

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("room.join"),
    protocolVersion,
    roomId,
    role: RoleSchema,
    endpointId,
    browser: BrowserInfoSchema.optional(),
    videoCodecs: VideoCodecCapabilitiesSchema.optional(),
  }),
  z.object({
    type: z.literal("room.leave"),
    protocolVersion,
    roomId,
    endpointId,
  }),
  z.object({
    type: z.literal("policy.hostUpdate"),
    protocolVersion,
    maxBitrateBps: z.number().int().positive().nullable(),
    maxFramerate: z.number().positive().nullable(),
    contentMode: ContentModeSchema,
    autoBitrate: z.boolean(),
    autoFramerate: z.boolean(),
  }),
  z.object({
    type: z.literal("telemetry.publish"),
    protocolVersion,
    roomId,
    summary: StatisticsSummarySchema,
    envelope: TelemetryEnvelopeSchema.optional(),
  }),
  z.object({
    type: z.literal("telemetry.clockProbe"),
    protocolVersion,
    probeId: z.string().min(1).max(128),
    clientSendTimeMs: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal("media.placeholder"),
    protocolVersion,
  }),
  z.object({
    type: z.literal("media.getRouterCapabilities"),
    protocolVersion,
    requestId,
  }),
  z.object({
    type: z.literal("media.createTransport"),
    protocolVersion,
    requestId,
    direction: z.enum(["send", "recv"]),
  }),
  z.object({
    type: z.literal("media.connectTransport"),
    protocolVersion,
    requestId,
    transportId: z.string().min(1),
    dtlsParameters: looseObject,
  }),
  z.object({
    type: z.literal("media.produce"),
    protocolVersion,
    requestId,
    transportId: z.string().min(1),
    kind: z.literal("video"),
    rtpParameters: looseObject,
    hdrMetadata: HdrMetadataSchema.optional(),
  }),
  z.object({
    type: z.literal("media.consume"),
    protocolVersion,
    requestId,
    transportId: z.string().min(1),
    producerId: z.string().min(1),
    rtpCapabilities: looseObject,
  }),
  z.object({
    type: z.literal("media.resumeConsumer"),
    protocolVersion,
    requestId,
    consumerId: z.string().min(1),
  }),
  z.object({
    type: z.literal("media.closeProducer"),
    protocolVersion,
    requestId,
    producerId: z.string().min(1),
  }),
  z.object({
    type: z.literal("media.getServerStats"),
    protocolVersion,
    requestId,
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type MediaRequestMessage = Extract<ClientMessage, { requestId: string }>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("room.joined"),
    protocolVersion,
    roomId,
    role: RoleSchema,
    endpointId,
    peerPresent: z.boolean(),
    selectedVideoCodec: VideoCodecSchema.nullable().optional(),
    compatibleVideoCodecs: z.array(VideoCodecSchema).max(3).optional(),
  }),
  z.object({
    type: z.literal("room.peerUpdate"),
    protocolVersion,
    roomId,
    peerRole: RoleSchema,
    present: z.boolean(),
    selectedVideoCodec: VideoCodecSchema.nullable().optional(),
    compatibleVideoCodecs: z.array(VideoCodecSchema).max(3).optional(),
  }),
  z.object({
    type: z.literal("room.error"),
    protocolVersion,
    code: z.enum(["INVALID_MESSAGE", "ROLE_TAKEN", "UNSUPPORTED_PROTOCOL"]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("telemetry.peerSummary"),
    protocolVersion,
    peerRole: RoleSchema,
    summary: StatisticsSummarySchema,
    envelope: TelemetryEnvelopeSchema.optional(),
  }),
  z.object({
    type: z.literal("telemetry.clockProbeResult"),
    protocolVersion,
    probeId: z.string().min(1).max(128),
    clientSendTimeMs: z.number().finite().nonnegative(),
    serverReceiveTimeMs: z.number().finite().nonnegative(),
    serverSendTimeMs: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal("media.placeholder"),
    protocolVersion,
    note: z.string(),
  }),
  z.object({
    type: z.literal("media.routerCapabilities"),
    protocolVersion,
    requestId,
    rtpCapabilities: looseObject,
  }),
  z.object({
    type: z.literal("media.transportCreated"),
    protocolVersion,
    requestId,
    transport: z.object({
      id: z.string().min(1),
      iceParameters: looseObject,
      iceCandidates: z.array(looseObject),
      dtlsParameters: looseObject,
      sctpParameters: looseObject.nullable(),
    }),
  }),
  z.object({
    type: z.literal("media.produced"),
    protocolVersion,
    requestId,
    producerId: z.string().min(1),
  }),
  z.object({
    type: z.literal("media.consumerCreated"),
    protocolVersion,
    requestId,
    consumer: z.object({
      id: z.string().min(1),
      producerId: z.string().min(1),
      kind: z.literal("video"),
      rtpParameters: looseObject,
    }),
  }),
  z.object({
    type: z.literal("media.ack"),
    protocolVersion,
    requestId,
  }),
  z.object({
    type: z.literal("media.serverStats"),
    protocolVersion,
    requestId,
    stats: ServerMediaStatisticsSchema,
  }),
  z.object({
    type: z.literal("media.error"),
    protocolVersion,
    requestId: z.string().optional(),
    code: z.enum([
      "MEDIA_NOT_READY",
      "NOT_JOINED",
      "NOT_AUTHORIZED",
      "NOT_FOUND",
      "CANNOT_CONSUME",
      "MEDIA_OPERATION_FAILED",
    ]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("media.producerAvailable"),
    protocolVersion,
    producerId: z.string().min(1),
    codec: VideoCodecSchema.optional(),
    hdrMetadata: HdrMetadataSchema.optional(),
  }),
  z.object({
    type: z.literal("media.producerClosed"),
    protocolVersion,
    producerId: z.string().min(1),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type MediaResponseMessage =
  | Extract<ServerMessage, { requestId: string }>
  | Extract<ServerMessage, { type: "media.error" }>;

export function parseClientMessage(value: unknown): ClientMessage {
  return ClientMessageSchema.parse(value);
}

export function safeParseClientMessage(value: unknown) {
  return ClientMessageSchema.safeParse(value);
}

export function parseServerMessage(value: unknown): ServerMessage {
  return ServerMessageSchema.parse(value);
}

export function safeParseServerMessage(value: unknown) {
  return ServerMessageSchema.safeParse(value);
}

export function parseTelemetryEnvelope(value: unknown): TelemetryEnvelope {
  return TelemetryEnvelopeSchema.parse(value);
}

export type { CapabilityFlags } from "./defaults.js";
export {
  CapabilityFlagsSchema,
  createCapabilityFlags,
  createEmptyStatisticsSummary,
} from "./defaults.js";
