import type { StatisticsSummary, VideoCodec } from "@conference/protocol";

const RESOLUTION_SCALES = [1, 1.25, 1.5, 2, 2.5, 3, 4] as const;
const PRESSURE_SAMPLES = 2;
const STALL_SAMPLES = 3;
const RECOVERY_SAMPLES = 20;
const ADJUSTMENT_COOLDOWN_SAMPLES = 6;

export interface BalancedControllerSettings {
  automaticBitrate: boolean;
  fallbackCodec?: VideoCodec;
  maxBitrateBps: number;
  maxFps: number;
  scaleResolutionDownBy: number;
}

export type BalancedControllerAction =
  | { type: "none"; state: string }
  | { type: "restart"; state: string }
  | { type: "scale"; scaleResolutionDownBy: number; state: string }
  | { type: "codec"; codec: VideoCodec; state: string }
  | { type: "bitrate"; maxBitrateBps: number; state: string };

function nextScale(current: number, direction: 1 | -1): number | null {
  const index = RESOLUTION_SCALES.findIndex((scale) => scale >= current - 0.01);
  const target = RESOLUTION_SCALES[index + direction];
  return target ?? null;
}

function pressureScale(
  current: number,
  expectedFps: number,
  encodeFps: number | null,
): number | null {
  const minimumNext = nextScale(current, 1);
  if (minimumNext === null) {
    return null;
  }
  const cadenceRatio = expectedFps / Math.max(1, encodeFps ?? expectedFps);
  const required = current * Math.sqrt(cadenceRatio);
  return RESOLUTION_SCALES.find((scale) => scale >= Math.max(minimumNext, required - 0.05)) ?? 4;
}

function finiteValues(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

export class BalancedMediaController {
  #pressureSamples = 0;
  #stableSamples = 0;
  #stallSamples = 0;
  #headroomSamples = 0;
  #cooldownSamples = 0;

  reset(): void {
    this.#pressureSamples = 0;
    this.#stableSamples = 0;
    this.#stallSamples = 0;
    this.#headroomSamples = 0;
    this.#cooldownSamples = 0;
  }

  observe(
    summary: StatisticsSummary,
    settings: BalancedControllerSettings,
  ): BalancedControllerAction {
    if (this.#cooldownSamples > 0) {
      this.#cooldownSamples -= 1;
    }
    const observedSourceFps = Math.max(summary.previewFps ?? 0, summary.captureFps ?? 0);
    const expectedFps =
      observedSourceFps > 0 ? Math.min(settings.maxFps, observedSourceFps) : settings.maxFps;
    const encodeFps = summary.encodeFps;
    const frameBudgetMs = 1_000 / Math.max(1, settings.maxFps);
    const cadencePressure =
      encodeFps !== null && expectedFps >= 20 && encodeFps < expectedFps * 0.85;
    const computePressure =
      summary.qualityLimitationReason === "cpu" ||
      (summary.encodeTimeMsPerFrame !== null &&
        summary.encodeTimeMsPerFrame > frameBudgetMs * 0.78);
    const networkPressure =
      summary.qualityLimitationReason === "bandwidth" ||
      (summary.packetSendDelayMsPerPacket ?? 0) > 30 ||
      (summary.packetLossPercent ?? 0) > 1.5;
    const stalled =
      summary.mediaFlowState === "stalled" &&
      (summary.transportState === "connected" || summary.dtlsState === "connected");

    this.#stallSamples = stalled ? this.#stallSamples + 1 : 0;
    if (this.#stallSamples >= STALL_SAMPLES && this.#cooldownSamples === 0) {
      this.#afterAdjustment();
      return { type: "restart", state: "balanced · recovering stalled sender" };
    }

    const underPressure = cadencePressure && (computePressure || networkPressure);
    this.#pressureSamples = underPressure ? this.#pressureSamples + 1 : 0;
    const stable =
      encodeFps !== null && encodeFps >= expectedFps * 0.93 && !computePressure && !networkPressure;
    this.#stableSamples = stable ? this.#stableSamples + 1 : 0;

    if (this.#pressureSamples >= PRESSURE_SAMPLES && this.#cooldownSamples === 0) {
      const softwareAv1 =
        settings.fallbackCodec &&
        summary.codec?.toLowerCase() === "video/av1" &&
        summary.encoderImplementation?.toLowerCase().includes("libaom");
      if (softwareAv1) {
        this.#afterAdjustment();
        return {
          type: "codec",
          codec: settings.fallbackCodec as VideoCodec,
          state: "balanced · selecting a faster hardware encoder",
        };
      }
      const scale = pressureScale(settings.scaleResolutionDownBy, expectedFps, encodeFps);
      if (scale !== null) {
        this.#afterAdjustment();
        return {
          type: "scale",
          scaleResolutionDownBy: scale,
          state: `balanced · protecting cadence at ${scale}× scale`,
        };
      }
      if (computePressure && settings.fallbackCodec) {
        this.#afterAdjustment();
        return {
          type: "codec",
          codec: settings.fallbackCodec,
          state: "balanced · selecting a faster encoder",
        };
      }
    }

    const pathCapacity = Math.max(
      ...finiteValues([summary.availableOutgoingBitrateBps, summary.serverAvailableBitrateBps]),
    );
    const senderEstimateAtCeiling =
      summary.availableOutgoingBitrateBps === null ||
      summary.availableOutgoingBitrateBps >= settings.maxBitrateBps * 0.9;
    const encoderAtCeiling =
      (summary.encoderTargetBitrateBps ?? 0) >= settings.maxBitrateBps * 0.88;
    const qualityWantsMore =
      (summary.qpAverage ?? 0) >= 25 || summary.qualityLimitationReason === "bandwidth";
    const hasHeadroom =
      Number.isFinite(pathCapacity) &&
      senderEstimateAtCeiling &&
      pathCapacity > settings.maxBitrateBps * 1.25 &&
      encoderAtCeiling &&
      qualityWantsMore;
    this.#headroomSamples = hasHeadroom ? this.#headroomSamples + 1 : 0;
    if (settings.automaticBitrate && this.#headroomSamples >= 5 && this.#cooldownSamples === 0) {
      const raised = Math.min(100_000_000, pathCapacity * 0.85, settings.maxBitrateBps * 1.25);
      if (raised > settings.maxBitrateBps + 250_000) {
        this.#afterAdjustment();
        return {
          type: "bitrate",
          maxBitrateBps: Math.round(raised / 250_000) * 250_000,
          state: "balanced · expanding quality into available bandwidth",
        };
      }
    }

    if (this.#stableSamples >= RECOVERY_SAMPLES && this.#cooldownSamples === 0) {
      const scale = nextScale(settings.scaleResolutionDownBy, -1);
      if (scale !== null) {
        this.#afterAdjustment();
        return {
          type: "scale",
          scaleResolutionDownBy: scale,
          state: `balanced · restoring detail at ${scale}× scale`,
        };
      }
    }

    const state = underPressure
      ? `balanced · evaluating ${computePressure ? "encoder" : "network"} pressure`
      : "balanced · cadence protected";
    return { type: "none", state };
  }

  #afterAdjustment(): void {
    this.#pressureSamples = 0;
    this.#stableSamples = 0;
    this.#stallSamples = 0;
    this.#headroomSamples = 0;
    this.#cooldownSamples = ADJUSTMENT_COOLDOWN_SAMPLES;
  }
}
