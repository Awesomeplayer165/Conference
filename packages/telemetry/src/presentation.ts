import { computePercentiles } from "./metrics.js";

export interface VideoFrameMetadataLike {
  presentedFrames: number;
  captureTime?: number;
}

export interface PresentationSample {
  presentationFps: number;
  frameCadenceDeviationMs: number | null;
  freezeCount: number;
  freezeDurationMs: number;
  estimatedLatencyMs: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
}

function rounded(value: number | null, digits = 2): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export class FramePresentationMonitor {
  #startedAt: number | null = null;
  #presentedFrames = 0;
  #lastAt: number | null = null;
  #intervals: number[] = [];
  #freezeCount = 0;
  #freezeDurationMs = 0;
  #latestLatencyMs: number | null = null;
  #latencySamples: number[] = [];

  reset(): void {
    this.#startedAt = null;
    this.#presentedFrames = 0;
    this.#lastAt = null;
    this.#intervals = [];
    this.#freezeCount = 0;
    this.#freezeDurationMs = 0;
    this.#latestLatencyMs = null;
    this.#latencySamples = [];
  }

  observe(now: number, metadata: VideoFrameMetadataLike): PresentationSample | null {
    if (metadata.presentedFrames < this.#presentedFrames) {
      this.reset();
    }
    if (this.#startedAt === null) {
      this.#startedAt = now;
      this.#presentedFrames = metadata.presentedFrames;
      this.#lastAt = now;
      return null;
    }
    if (this.#lastAt !== null) {
      const interval = now - this.#lastAt;
      this.#intervals.push(interval);
      const typical =
        this.#intervals.length > 1
          ? this.#intervals.slice(0, -1).reduce((sum, value) => sum + value, 0) /
            (this.#intervals.length - 1)
          : 1000 / 30;
      const freezeThreshold = Math.max(500, typical * 3);
      if (interval > freezeThreshold) {
        this.#freezeCount += 1;
        this.#freezeDurationMs += interval - typical;
      }
    }
    this.#lastAt = now;
    if (
      typeof metadata.captureTime === "number" &&
      Number.isFinite(metadata.captureTime) &&
      now >= metadata.captureTime
    ) {
      this.#latestLatencyMs = now - metadata.captureTime;
      this.#latencySamples.push(this.#latestLatencyMs);
      if (this.#latencySamples.length > 1_800) {
        this.#latencySamples.shift();
      }
    }

    const elapsedSeconds = (now - this.#startedAt) / 1_000;
    if (elapsedSeconds < 1) {
      return null;
    }
    const latencyPercentiles = computePercentiles(this.#latencySamples);
    const sample: PresentationSample = {
      presentationFps: Number(
        ((metadata.presentedFrames - this.#presentedFrames) / elapsedSeconds).toFixed(1),
      ),
      frameCadenceDeviationMs: rounded(standardDeviation(this.#intervals)),
      freezeCount: this.#freezeCount,
      freezeDurationMs: rounded(this.#freezeDurationMs) ?? 0,
      estimatedLatencyMs: rounded(this.#latestLatencyMs),
      latencyP50Ms: rounded(latencyPercentiles.p50),
      latencyP95Ms: rounded(latencyPercentiles.p95),
      latencyP99Ms: rounded(latencyPercentiles.p99),
    };
    this.#startedAt = now;
    this.#presentedFrames = metadata.presentedFrames;
    this.#intervals = [];
    return sample;
  }
}
