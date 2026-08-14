import { describe, expect, it } from "bun:test";
import {
  createCapabilityFlags,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  parseTelemetryEnvelope,
  safeParseClientMessage,
} from "./index.js";

describe("signaling round-trips", () => {
  it("parses room.join", () => {
    const msg = parseClientMessage({
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "demo",
      role: "host",
      endpointId: "ep-1",
      browser: { name: "Chrome", version: "128", os: "macOS" },
      videoCodecs: {
        send: ["video/AV1", "video/H264"],
        receive: ["video/AV1", "video/H264"],
      },
    });
    expect(msg).toMatchObject({
      type: "room.join",
      role: "host",
      videoCodecs: { send: ["video/AV1", "video/H264"] },
    });
  });

  it("rejects unsupported protocol version", () => {
    const result = safeParseClientMessage({
      type: "room.join",
      protocolVersion: 999,
      roomId: "demo",
      role: "viewer",
      endpointId: "ep-2",
    });
    expect(result.success).toBe(false);
  });

  it("parses room.joined", () => {
    const msg = parseServerMessage({
      type: "room.joined",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "demo",
      role: "viewer",
      endpointId: "ep-2",
      peerPresent: false,
      selectedVideoCodec: null,
    });
    expect(msg).toMatchObject({ type: "room.joined", peerPresent: false });
  });

  it("parses host policy update with null auto ceilings", () => {
    const msg = parseClientMessage({
      type: "policy.hostUpdate",
      protocolVersion: PROTOCOL_VERSION,
      maxBitrateBps: null,
      maxFramerate: null,
      contentMode: "auto",
      autoBitrate: true,
      autoFramerate: true,
    });
    expect(msg).toMatchObject({
      type: "policy.hostUpdate",
      autoBitrate: true,
    });
  });

  it("parses Stage 2 mediasoup requests and responses", () => {
    expect(
      parseClientMessage({
        type: "media.createTransport",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "request-1",
        direction: "send",
      }),
    ).toMatchObject({
      type: "media.createTransport",
      direction: "send",
    });
    expect(
      parseServerMessage({
        type: "media.produced",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "request-1",
        producerId: "producer-1",
      }),
    ).toMatchObject({
      type: "media.produced",
      producerId: "producer-1",
    });
  });

  it("parses one-way display audio media messages", () => {
    expect(
      parseClientMessage({
        type: "media.produce",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "audio-produce",
        transportId: "send-1",
        kind: "audio",
        rtpParameters: {},
      }),
    ).toMatchObject({ type: "media.produce", kind: "audio" });
    expect(
      parseServerMessage({
        type: "media.producerAvailable",
        protocolVersion: PROTOCOL_VERSION,
        producerId: "audio-1",
        kind: "audio",
      }),
    ).toMatchObject({ type: "media.producerAvailable", kind: "audio" });
  });

  it("parses bounded receiver recovery messages", () => {
    expect(
      parseClientMessage({
        type: "media.requestConsumerKeyFrame",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "request-keyframe",
        consumerId: "consumer-1",
      }),
    ).toMatchObject({
      type: "media.requestConsumerKeyFrame",
      consumerId: "consumer-1",
    });
    expect(
      parseClientMessage({
        type: "media.requestCodecFallback",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "request-fallback",
        consumerId: "consumer-1",
        requestedCodec: "video/H264",
      }),
    ).toMatchObject({
      type: "media.requestCodecFallback",
      requestedCodec: "video/H264",
    });
    expect(
      parseServerMessage({
        type: "media.codecSwitchRequested",
        protocolVersion: PROTOCOL_VERSION,
        producerId: "producer-1",
        requestedCodec: "video/H264",
        reason: "decode-failure",
      }),
    ).toMatchObject({
      type: "media.codecSwitchRequested",
      reason: "decode-failure",
    });
  });
});

describe("telemetry round-trips", () => {
  it("parses envelope with absent optional metrics (not zero)", () => {
    const envelope = parseTelemetryEnvelope({
      schemaVersion: PROTOCOL_VERSION,
      sessionId: "s1",
      endpointId: "ep-1",
      role: "host",
      wallTime: new Date().toISOString(),
      monotonicTime: 1000,
      sequence: 0,
      kind: "sample",
      presence: { qpAverage: false, rttMs: true },
      payload: {
        captureWidth: 3024,
        captureHeight: 1964,
        captureFps: 60,
        qpAverage: null,
        rttMs: 12.5,
      },
    });
    expect(envelope.payload.qpAverage).toBeNull();
    expect(envelope.presence?.qpAverage).toBe(false);
  });

  it("parses clock probes without exposing them as media requests", () => {
    expect(
      parseClientMessage({
        type: "telemetry.clockProbe",
        protocolVersion: PROTOCOL_VERSION,
        probeId: "probe-1",
        clientSendTimeMs: 1_000,
      }),
    ).toMatchObject({ type: "telemetry.clockProbe", probeId: "probe-1" });
    expect(
      parseServerMessage({
        type: "telemetry.clockProbeResult",
        protocolVersion: PROTOCOL_VERSION,
        probeId: "probe-1",
        clientSendTimeMs: 1_000,
        serverReceiveTimeMs: 1_010,
        serverSendTimeMs: 1_011,
      }),
    ).toMatchObject({
      type: "telemetry.clockProbeResult",
      serverSendTimeMs: 1_011,
    });
  });
});

describe("capability flags", () => {
  it("defaults unknown features to false", () => {
    const flags = createCapabilityFlags({ getDisplayMedia: true, h264: true });
    expect(flags.getDisplayMedia).toBe(true);
    expect(flags.av1).toBe(false);
    expect(flags.h265).toBe(false);
    expect(flags.contentHint).toBe(false);
    expect(flags.encodedTransform).toBe(false);
  });
});
