import type { StatisticsSummary } from "@conference/protocol";
import { computePercentiles } from "./metrics.js";

type StatsRecord = RTCStats & Record<string, unknown>;

export interface WebRtcStatsReports {
  sender: RTCStatsReport | null;
  receiver: RTCStatsReport | null;
  transport: RTCStatsReport | null;
}

interface PreviousStats {
  timestamp: number;
  values: Record<string, number>;
}

const COUNTER_NAMES = [
  "frames",
  "bytesSent",
  "bytesReceived",
  "packetsSent",
  "framesEncoded",
  "framesDecoded",
  "keyFramesEncoded",
  "keyFramesDecoded",
  "qpSum",
  "totalEncodeTime",
  "totalDecodeTime",
  "totalPacketSendDelay",
  "packetsLost",
  "packetsReceived",
  "jitterBufferDelay",
  "jitterBufferEmittedCount",
] as const;

function numberValue(record: StatsRecord | null, name: string): number | null {
  const value = record?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumberValue(record: StatsRecord | null, name: string): number | null {
  const value = numberValue(record, name);
  return value !== null && value > 0 ? value : null;
}

function stringValue(record: StatsRecord | null, name: string): string | null {
  const value = record?.[name];
  return typeof value === "string" ? value : null;
}

function booleanValue(record: StatsRecord | null, name: string): boolean | null {
  const value = record?.[name];
  return typeof value === "boolean" ? value : null;
}

function videoRecord(
  records: readonly StatsRecord[],
  recordsById: ReadonlyMap<string, StatsRecord>,
  previous: ReadonlyMap<string, PreviousStats>,
  type: "outbound-rtp" | "inbound-rtp" | "remote-inbound-rtp",
): StatsRecord | null {
  const candidates = records.filter((record) => {
    if (
      record.type !== type ||
      (record.kind !== "video" && record.mediaType !== "video") ||
      record.isRemote === true ||
      record.active === false
    ) {
      return false;
    }
    const codecId = stringValue(record, "codecId");
    const codec = codecId ? (recordsById.get(codecId) ?? null) : null;
    return !stringValue(codec, "mimeType")?.toLowerCase().endsWith("/rtx");
  });
  const bytesName = type === "outbound-rtp" ? "bytesSent" : "bytesReceived";
  const framesName = type === "outbound-rtp" ? "framesEncoded" : "framesDecoded";
  const activityScore = (record: StatsRecord): number => {
    const prior = previous.get(record.id);
    const explicitlyActive = record.active === true ? 1 : 0;
    if (!prior) {
      // A replacement SSRC starts with small cumulative counters. Prefer it over a
      // high-byte, stopped SSRC retained by Chrome after producer replacement.
      return explicitlyActive + 4;
    }
    const bytesChange = delta(record, prior, bytesName) ?? 0;
    const framesChange = delta(record, prior, framesName) ?? 0;
    return explicitlyActive + (bytesChange > 0 ? 2 : 0) + (framesChange > 0 ? 2 : 0);
  };
  return (
    candidates.sort((left, right) => {
      const activityDifference = activityScore(right) - activityScore(left);
      if (activityDifference !== 0) {
        return activityDifference;
      }
      return right.timestamp - left.timestamp;
    })[0] ?? null
  );
}

function delta(
  current: StatsRecord | null,
  previous: PreviousStats | undefined,
  name: string,
): number | null {
  if (!current || !previous || current.timestamp <= previous.timestamp) {
    return null;
  }
  const currentValue = numberValue(current, name);
  const previousValue = previous.values[name];
  if (currentValue === null || previousValue === undefined || currentValue < previousValue) {
    return null;
  }
  return currentValue - previousValue;
}

function perSecond(
  change: number | null,
  current: StatsRecord | null,
  previous: PreviousStats | undefined,
): number | null {
  if (change === null || !current || !previous) {
    return null;
  }
  const elapsedSeconds = (current.timestamp - previous.timestamp) / 1_000;
  return elapsedSeconds > 0 ? change / elapsedSeconds : null;
}

function rounded(value: number | null, digits = 2): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function profileLevelId(codec: StatsRecord | null): string | null {
  const fmtp = stringValue(codec, "sdpFmtpLine");
  return fmtp?.match(/profile-level-id=([0-9a-f]+)/i)?.[1] ?? null;
}

export class WebRtcStatsNormalizer {
  readonly #previous = new Map<string, PreviousStats>();
  #mediaIdentity: string | null = null;
  #minimumRttMs: number | null = null;
  #previousRttMs: number | null = null;
  #latencySamples: number[] = [];

  reset(): void {
    this.#previous.clear();
    this.#mediaIdentity = null;
    this.#minimumRttMs = null;
    this.#previousRttMs = null;
    this.#latencySamples = [];
  }

  sample(reports: WebRtcStatsReports): Partial<StatisticsSummary> {
    const recordsById = new Map<string, StatsRecord>();
    for (const report of [reports.sender, reports.receiver, reports.transport]) {
      report?.forEach((record) => {
        recordsById.set(record.id, record as StatsRecord);
      });
    }
    const records = [...recordsById.values()];
    const outbound = videoRecord(records, recordsById, this.#previous, "outbound-rtp");
    const inbound = videoRecord(records, recordsById, this.#previous, "inbound-rtp");
    const linkedRemoteId = stringValue(outbound, "remoteId");
    const remoteInbound = linkedRemoteId
      ? (recordsById.get(linkedRemoteId) ?? null)
      : videoRecord(records, recordsById, this.#previous, "remote-inbound-rtp");
    const media = outbound ?? inbound;
    if (!media) {
      return {};
    }

    const ssrc = numberValue(media, "ssrc");
    const mediaIdentity = `${media.id}:${ssrc ?? "unknown"}`;
    const streamChanged = this.#mediaIdentity !== null && this.#mediaIdentity !== mediaIdentity;
    if (streamChanged) {
      this.#previous.delete(media.id);
      this.#minimumRttMs = null;
      this.#previousRttMs = null;
      this.#latencySamples = [];
    }
    this.#mediaIdentity = mediaIdentity;

    const previousMedia = streamChanged ? undefined : this.#previous.get(media.id);
    const bytesName = outbound ? "bytesSent" : "bytesReceived";
    const frameName = outbound ? "framesEncoded" : "framesDecoded";
    const bytesPerSecond = perSecond(delta(media, previousMedia, bytesName), media, previousMedia);
    const reportedFrameRate = numberValue(media, "framesPerSecond");
    const derivedFrameRate = perSecond(
      delta(media, previousMedia, frameName),
      media,
      previousMedia,
    );
    const frameRate =
      reportedFrameRate !== null && reportedFrameRate > 0
        ? reportedFrameRate
        : (derivedFrameRate ?? reportedFrameRate);
    const mediaSourceId = stringValue(outbound, "mediaSourceId");
    const mediaSource = mediaSourceId
      ? (recordsById.get(mediaSourceId) ?? null)
      : (records.find((record) => record.type === "media-source" && record.kind === "video") ??
        null);
    const previousMediaSource =
      mediaSource && !streamChanged ? this.#previous.get(mediaSource.id) : undefined;
    const reportedCaptureFps = numberValue(mediaSource, "framesPerSecond");
    const derivedCaptureFps = mediaSource
      ? perSecond(
          delta(mediaSource, previousMediaSource, "frames"),
          mediaSource,
          previousMediaSource,
        )
      : null;
    const captureFps =
      reportedCaptureFps !== null && reportedCaptureFps > 0
        ? reportedCaptureFps
        : derivedCaptureFps !== null && derivedCaptureFps > 0
          ? derivedCaptureFps
          : null;

    const transport = stringValue(media, "transportId");
    const transportRecord = transport
      ? (recordsById.get(transport) ?? null)
      : (records.find((record) => record.type === "transport") ?? null);
    const pairId = stringValue(transportRecord, "selectedCandidatePairId");
    const candidatePair = pairId
      ? (recordsById.get(pairId) ?? null)
      : (records.find(
          (record) =>
            record.type === "candidate-pair" &&
            (record.nominated === true || record.selected === true),
        ) ?? null);
    const localCandidateId = stringValue(candidatePair, "localCandidateId");
    const localCandidate = localCandidateId ? (recordsById.get(localCandidateId) ?? null) : null;

    const candidatePairState = stringValue(candidatePair, "state");
    const candidatePairUsable =
      candidatePair !== null &&
      (candidatePairState === "succeeded" ||
        candidatePair.nominated === true ||
        candidatePair.selected === true);
    const rttSeconds =
      (candidatePairUsable ? numberValue(candidatePair, "currentRoundTripTime") : null) ??
      numberValue(remoteInbound, "roundTripTime");
    const rttMs = rttSeconds === null ? null : rttSeconds * 1_000;
    if (rttMs !== null) {
      this.#minimumRttMs =
        this.#minimumRttMs === null ? rttMs : Math.min(this.#minimumRttMs, rttMs);
    }
    const rttTrendMs =
      rttMs === null || this.#previousRttMs === null ? null : rttMs - this.#previousRttMs;
    this.#previousRttMs = rttMs;

    const lossRecord = outbound ? remoteInbound : inbound;
    const previousLoss =
      lossRecord && !streamChanged ? this.#previous.get(lossRecord.id) : undefined;
    const lostDelta = delta(lossRecord, previousLoss, "packetsLost");
    const receivedDelta = delta(lossRecord, previousLoss, "packetsReceived");
    const lossTotal =
      lostDelta === null || receivedDelta === null ? null : lostDelta + receivedDelta;
    const packetLossPercent =
      lostDelta === null || lossTotal === null || lossTotal <= 0
        ? null
        : (lostDelta / lossTotal) * 100;

    const framesDelta = delta(media, previousMedia, frameName);
    const qpDelta = delta(media, previousMedia, "qpSum");
    const processingName = outbound ? "totalEncodeTime" : "totalDecodeTime";
    const processingDelta = delta(media, previousMedia, processingName);
    const processingMs =
      processingDelta === null || framesDelta === null || framesDelta <= 0
        ? null
        : (processingDelta / framesDelta) * 1_000;
    const packetsName = outbound ? "packetsSent" : "packetsReceived";
    const packetsDelta = delta(media, previousMedia, packetsName);
    const packetSendDelayDelta = outbound
      ? delta(media, previousMedia, "totalPacketSendDelay")
      : null;
    const packetSendDelayMsPerPacket =
      packetSendDelayDelta === null || packetsDelta === null || packetsDelta <= 0
        ? null
        : (packetSendDelayDelta / packetsDelta) * 1_000;

    const previousInbound = inbound ? this.#previous.get(inbound.id) : undefined;
    const jitterBufferDelay = delta(inbound, previousInbound, "jitterBufferDelay");
    const jitterBufferFrames = delta(inbound, previousInbound, "jitterBufferEmittedCount");
    const jitterBufferMs =
      jitterBufferDelay === null || jitterBufferFrames === null || jitterBufferFrames <= 0
        ? null
        : (jitterBufferDelay / jitterBufferFrames) * 1_000;
    const estimatedLatencyComponents =
      inbound && framesDelta !== null && framesDelta > 0
        ? [rttMs === null ? null : rttMs / 2, jitterBufferMs, processingMs].filter(
            (value): value is number => value !== null,
          )
        : [];
    const estimatedLatencyMs =
      estimatedLatencyComponents.length === 0
        ? null
        : estimatedLatencyComponents.reduce((sum, value) => sum + value, 0);
    if (estimatedLatencyMs !== null) {
      this.#latencySamples.push(estimatedLatencyMs);
      if (this.#latencySamples.length > 900) {
        this.#latencySamples.shift();
      }
    }
    const latencyPercentiles = computePercentiles(this.#latencySamples);

    const codecId = stringValue(media, "codecId");
    const codec = codecId ? (recordsById.get(codecId) ?? null) : null;
    const bytesDelta = delta(media, previousMedia, bytesName);
    const dtlsState = stringValue(transportRecord, "dtlsState");
    const failed =
      dtlsState === "failed" || dtlsState === "closed" || candidatePairState === "failed";
    const mediaFlowState = failed
      ? "failed"
      : previousMedia === undefined
        ? "starting"
        : (bytesDelta ?? 0) > 0 && (framesDelta ?? 0) > 0
          ? "flowing"
          : (bytesDelta ?? 0) > 0
            ? "RTP packets without complete frames"
            : "stalled";
    const cumulativePackets =
      (numberValue(lossRecord, "packetsReceived") ?? 0) +
      (numberValue(lossRecord, "packetsLost") ?? 0);
    const cumulativeFramesDecoded = inbound ? numberValue(inbound, "framesDecoded") : null;
    const reportedKeyFramesDecoded = inbound ? numberValue(inbound, "keyFramesDecoded") : null;
    const cumulativeKeyFramesDecoded =
      cumulativeFramesDecoded === null || reportedKeyFramesDecoded === null
        ? null
        : Math.min(cumulativeFramesDecoded, reportedKeyFramesDecoded);
    const sample: Partial<StatisticsSummary> = {
      codec: stringValue(codec, "mimeType"),
      encoderTargetBitrateBps: outbound ? rounded(numberValue(outbound, "targetBitrate"), 0) : null,
      actualBitrateBps: rounded(bytesPerSecond === null ? null : bytesPerSecond * 8, 0),
      availableOutgoingBitrateBps:
        outbound && candidatePairUsable
          ? rounded(numberValue(candidatePair, "availableOutgoingBitrate"), 0)
          : null,
      rttMs: rounded(rttMs),
      minRttMs: rounded(this.#minimumRttMs),
      rttTrendMs: rounded(rttTrendMs),
      jitterMs: rounded(
        (() => {
          const jitter = numberValue(lossRecord, "jitter");
          return jitter === null ? null : jitter * 1_000;
        })(),
      ),
      jitterBufferDelayMs: inbound ? rounded(jitterBufferMs) : null,
      packetLossPercent: rounded(packetLossPercent, 3),
      packetsLost: cumulativePackets > 0 ? numberValue(lossRecord, "packetsLost") : null,
      nackCount: numberValue(media, "nackCount"),
      retransmittedPackets:
        numberValue(media, "retransmittedPacketsSent") ??
        numberValue(media, "retransmittedPacketsReceived"),
      pliCount: numberValue(media, "pliCount"),
      firCount: numberValue(media, "firCount"),
      framesEncoded: outbound ? numberValue(outbound, "framesEncoded") : null,
      framesDecoded: cumulativeFramesDecoded,
      keyFramesEncoded: outbound ? numberValue(outbound, "keyFramesEncoded") : null,
      keyFramesDecoded: cumulativeKeyFramesDecoded,
      packetSendDelayMsPerPacket: outbound ? rounded(packetSendDelayMsPerPacket) : null,
      qpAverage:
        qpDelta === null || framesDelta === null || framesDelta <= 0
          ? null
          : rounded(qpDelta / framesDelta),
      encodeTimeMsPerFrame: outbound ? rounded(processingMs) : null,
      decodeTimeMsPerFrame: inbound ? rounded(processingMs) : null,
      droppedFrames: numberValue(media, "framesDropped"),
      freezeCount: inbound ? numberValue(inbound, "freezeCount") : null,
      freezeDurationMs: inbound
        ? rounded(
            (() => {
              const seconds = numberValue(inbound, "totalFreezesDuration");
              return seconds === null ? null : seconds * 1_000;
            })(),
          )
        : null,
      estimatedLatencyMs: rounded(estimatedLatencyMs),
      latencyP50Ms: rounded(latencyPercentiles.p50),
      latencyP95Ms: rounded(latencyPercentiles.p95),
      latencyP99Ms: rounded(latencyPercentiles.p99),
      qualityLimitationReason: outbound ? stringValue(outbound, "qualityLimitationReason") : null,
      encoderImplementation: outbound ? stringValue(outbound, "encoderImplementation") : null,
      decoderImplementation: inbound ? stringValue(inbound, "decoderImplementation") : null,
      encoderPowerEfficient: outbound ? booleanValue(outbound, "powerEfficientEncoder") : null,
      decoderPowerEfficient: inbound ? booleanValue(inbound, "powerEfficientDecoder") : null,
      h264ProfileLevelId: profileLevelId(codec),
      mediaFlowState,
      dtlsState,
      candidatePairState,
      localCandidateCount: records.filter((record) => record.type === "local-candidate").length,
      remoteCandidateCount: records.filter((record) => record.type === "remote-candidate").length,
      candidatePairCount: records.filter((record) => record.type === "candidate-pair").length,
      transportProtocol: stringValue(localCandidate, "protocol"),
    };

    if (outbound) {
      sample.sourceWidth = positiveNumberValue(mediaSource, "width");
      sample.sourceHeight = positiveNumberValue(mediaSource, "height");
      sample.captureFps = rounded(captureFps);
      sample.encodedWidth = positiveNumberValue(outbound, "frameWidth");
      sample.encodedHeight = positiveNumberValue(outbound, "frameHeight");
      sample.encodeFps = rounded(frameRate);
    } else {
      sample.decodedWidth = positiveNumberValue(inbound, "frameWidth");
      sample.decodedHeight = positiveNumberValue(inbound, "frameHeight");
      sample.decodeFps = rounded(frameRate);
    }

    for (const record of records) {
      const values: Record<string, number> = {};
      for (const name of COUNTER_NAMES) {
        const value = numberValue(record, name);
        if (value !== null) {
          values[name] = value;
        }
      }
      this.#previous.set(record.id, {
        timestamp: record.timestamp,
        values,
      });
    }
    return sample;
  }
}
