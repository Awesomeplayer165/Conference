import { describe, expect, it } from "bun:test";
import { FramePresentationMonitor } from "./presentation.js";
import { WebRtcStatsNormalizer } from "./webrtc.js";

function report(records: Array<RTCStats & Record<string, unknown>>): RTCStatsReport {
  return new Map(records.map((record) => [record.id, record])) as unknown as RTCStatsReport;
}

function senderReport(
  timestamp: number,
  bytesSent: number,
  framesEncoded: number,
  qpSum: number,
  totalEncodeTime: number,
  ssrc = 1234,
): RTCStatsReport {
  return report([
    {
      id: "outbound",
      type: "outbound-rtp",
      timestamp,
      kind: "video",
      ssrc,
      bytesSent,
      packetsSent: framesEncoded,
      framesEncoded,
      qpSum,
      totalEncodeTime,
      frameWidth: 1920,
      frameHeight: 1080,
      codecId: "codec",
      transportId: "transport",
      mediaSourceId: "source",
      qualityLimitationReason: "none",
      targetBitrate: 12_000_000,
    },
    {
      id: "source",
      type: "media-source",
      timestamp,
      kind: "video",
      width: 3024,
      height: 1964,
      framesPerSecond: 60,
    },
    {
      id: "remote",
      type: "remote-inbound-rtp",
      timestamp,
      kind: "video",
      packetsLost: 0,
      packetsReceived: framesEncoded,
      roundTripTime: 0.02,
      jitter: 0.001,
    },
    {
      id: "codec",
      type: "codec",
      timestamp,
      mimeType: "video/H264",
      sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    },
    {
      id: "transport",
      type: "transport",
      timestamp,
      selectedCandidatePairId: "pair",
    },
    {
      id: "pair",
      type: "candidate-pair",
      timestamp,
      nominated: true,
      availableOutgoingBitrate: 20_000_000,
      currentRoundTripTime: 0.02,
      localCandidateId: "candidate",
    },
    {
      id: "candidate",
      type: "local-candidate",
      timestamp,
      protocol: "udp",
    },
  ]);
}

describe("WebRTC telemetry normalization", () => {
  it("computes one-second deltas without treating the first sample as zero", () => {
    const normalizer = new WebRtcStatsNormalizer();
    const first = normalizer.sample({
      sender: senderReport(1_000, 1_000, 30, 300, 0.3),
      receiver: null,
      transport: null,
    });
    expect(first.actualBitrateBps).toBeNull();

    const second = normalizer.sample({
      sender: senderReport(2_000, 2_000, 60, 600, 0.6),
      receiver: null,
      transport: null,
    });
    expect(second).toMatchObject({
      codec: "video/H264",
      sourceWidth: 3024,
      sourceHeight: 1964,
      captureFps: 60,
      encodedWidth: 1920,
      encodedHeight: 1080,
      encodeFps: 30,
      actualBitrateBps: 8_000,
      availableOutgoingBitrateBps: 20_000_000,
      encoderTargetBitrateBps: 12_000_000,
      rttMs: 20,
      minRttMs: 20,
      qpAverage: 10,
      encodeTimeMsPerFrame: 10,
      h264ProfileLevelId: "42e01f",
      transportProtocol: "udp",
    });
  });

  it("resets rate deltas when counters decrease", () => {
    const normalizer = new WebRtcStatsNormalizer();
    normalizer.sample({
      sender: senderReport(1_000, 10_000, 100, 1_000, 1),
      receiver: null,
      transport: null,
    });
    const reset = normalizer.sample({
      sender: senderReport(2_000, 100, 1, 10, 0.01),
      receiver: null,
      transport: null,
    });
    expect(reset.actualBitrateBps).toBeNull();
    expect(reset.qpAverage).toBeNull();
  });

  it("does not calculate deltas across an SSRC change", () => {
    const normalizer = new WebRtcStatsNormalizer();
    normalizer.sample({
      sender: senderReport(1_000, 10_000, 100, 1_000, 1, 111),
      receiver: null,
      transport: null,
    });
    const changed = normalizer.sample({
      sender: senderReport(2_000, 20_000, 200, 2_000, 2, 222),
      receiver: null,
      transport: null,
    });
    expect(changed.actualBitrateBps).toBeNull();
    expect(changed.encodeFps).toBeNull();
    expect(changed.qpAverage).toBeNull();
    expect(changed.latencyP50Ms).toBeNull();
  });

  it("uses frame-counter deltas when a browser reports a stale zero FPS field", () => {
    const normalizer = new WebRtcStatsNormalizer();
    const first = senderReport(1_000, 1_000, 30, 300, 0.3);
    const second = senderReport(2_000, 2_000, 90, 900, 0.9);
    (first.get("outbound") as RTCStats & Record<string, unknown>).framesPerSecond = 0;
    (second.get("outbound") as RTCStats & Record<string, unknown>).framesPerSecond = 0;
    normalizer.sample({ sender: first, receiver: null, transport: null });
    const sample = normalizer.sample({ sender: second, receiver: null, transport: null });
    expect(sample.encodeFps).toBe(60);
  });

  it("does not let a disconnected sender's zero media-source FPS hide a live preview", () => {
    const normalizer = new WebRtcStatsNormalizer();
    const sampleReport = senderReport(1_000, 0, 0, 0, 0);
    (sampleReport.get("source") as RTCStats & Record<string, unknown>).framesPerSecond = 0;
    const sample = normalizer.sample({ sender: sampleReport, receiver: null, transport: null });
    expect(sample.captureFps).toBeNull();
  });

  it("treats zero frame geometry and no-frame latency as unavailable", () => {
    const normalizer = new WebRtcStatsNormalizer();
    const inbound = (timestamp: number): RTCStatsReport =>
      report([
        {
          id: "inbound",
          type: "inbound-rtp",
          timestamp,
          kind: "video",
          ssrc: 222,
          bytesReceived: 10_000,
          packetsReceived: 10,
          packetsLost: 0,
          framesDecoded: 0,
          frameWidth: 0,
          frameHeight: 0,
          framesPerSecond: 0,
          jitterBufferDelay: 0,
          jitterBufferEmittedCount: 0,
          totalDecodeTime: 0,
        },
      ]);
    normalizer.sample({ sender: null, receiver: inbound(1_000), transport: null });
    const sample = normalizer.sample({ sender: null, receiver: inbound(2_000), transport: null });
    expect(sample).toMatchObject({
      decodedWidth: null,
      decodedHeight: null,
      decodeFps: 0,
      estimatedLatencyMs: null,
      latencyP50Ms: null,
    });
  });
});

describe("presentation telemetry", () => {
  it("measures rendered FPS and cadence", () => {
    const monitor = new FramePresentationMonitor();
    expect(monitor.observe(0, { presentedFrames: 0 })).toBeNull();
    expect(monitor.observe(500, { presentedFrames: 30 })).toBeNull();
    expect(monitor.observe(1_000, { presentedFrames: 60 })).toEqual({
      presentationFps: 60,
      frameCadenceDeviationMs: 0,
      freezeCount: 0,
      freezeDurationMs: 0,
      estimatedLatencyMs: null,
      latencyP50Ms: null,
      latencyP95Ms: null,
      latencyP99Ms: null,
    });
  });

  it("restarts its window when the browser frame counter resets", () => {
    const monitor = new FramePresentationMonitor();
    expect(monitor.observe(0, { presentedFrames: 100 })).toBeNull();
    expect(monitor.observe(1_000, { presentedFrames: 160 })?.presentationFps).toBe(60);
    expect(monitor.observe(1_100, { presentedFrames: 1 })).toBeNull();
    expect(monitor.observe(2_100, { presentedFrames: 61 })?.presentationFps).toBe(60);
  });
});
