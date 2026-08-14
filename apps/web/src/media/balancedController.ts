import type { StatisticsSummary, VideoCodec } from "@conference/protocol";

const RESOLUTION_SCALES = [1, 1.1, 1.2, 1.33, 1.5, 1.67, 2, 2.5, 3, 4] as const;
const PREFERRED_CODEC_SCALE_LIMIT = 2;
const PRESSURE_SAMPLES = 2;
const STALL_SAMPLES = 3;
const RECOVERY_SAMPLES = 6;
const ADJUSTMENT_COOLDOWN_SAMPLES = 3;
const CAPACITY_SAMPLES = 4;
const NETWORK_DISTRESS_SAMPLES = 5;
const PREFERRED_CODEC_RECOVERY_SAMPLES = 30;
const INITIAL_CODEC_RETRY_SAMPLES = 45;
const MAX_CODEC_RETRY_SAMPLES = 300;

export interface BalancedControllerSettings {
  activeCodec?: VideoCodec | null;
  automaticBitrate: boolean;
  bitrateCeilingBps?: number;
  fallbackCodec?: VideoCodec;
  maxBitrateBps: number;
  maxFps: number;
  preferredCodec?: VideoCodec;
  scaleResolutionDownBy: number;
}

export type BalancedControllerAction =
  | { type: "none"; state: string }
  | { type: "restart"; state: string }
  | { type: "scale"; scaleResolutionDownBy: number; state: string }
  | { type: "codec"; codec: VideoCodec; state: string }
  | { type: "bitrate"; maxBitrateBps: number; state: string };

interface PressureState {
  capture: boolean;
  compute: boolean;
  network: boolean;
  receiver: boolean;
  severe: boolean;
}

function nextScale(current: number, direction: 1 | -1): number | null {
  const index = RESOLUTION_SCALES.findIndex((scale) => scale >= current - 0.01);
  const target = RESOLUTION_SCALES[index + direction];
  return target ?? null;
}

function pressureScale(
  current: number,
  expectedFps: number,
  effectiveFps: number | null,
  maximum: number,
): number | null {
  const minimumNext = nextScale(current, 1);
  if (minimumNext === null || current >= maximum - 0.01) {
    return null;
  }
  const cadenceRatio = expectedFps / Math.max(1, effectiveFps ?? expectedFps);
  const required = current * Math.sqrt(cadenceRatio);
  const selected =
    RESOLUTION_SCALES.find(
      (scale) => scale > current + 0.01 && scale >= Math.min(maximum, required - 0.03),
    ) ?? maximum;
  return Math.min(maximum, selected);
}

function positiveNumbers(values: Array<number | null>): number[] {
  return values.filter(
    (value): value is number => value !== null && Number.isFinite(value) && value > 0,
  );
}

function pathCapacity(local: StatisticsSummary, peer: StatisticsSummary | null): number | null {
  const values = positiveNumbers([
    local.availableOutgoingBitrateBps,
    local.serverAvailableBitrateBps,
    peer?.serverAvailableBitrateBps ?? null,
  ]).filter((value) => value > 500_000);
  return values.length === 0 ? null : Math.min(...values);
}

function codecFromSummary(summary: StatisticsSummary): VideoCodec | null {
  switch (summary.codec?.toLowerCase()) {
    case "av1":
    case "video/av1":
      return "video/AV1";
    case "h265":
    case "video/h265":
      return "video/H265";
    case "h264":
    case "video/h264":
      return "video/H264";
    default:
      return null;
  }
}

function resolutionPercent(scale: number): number {
  return Math.round((100 / scale) * 10) / 10;
}

function softwareEncoder(implementation: string | null): boolean {
  const normalized = implementation?.toLowerCase() ?? "";
  return ["libaom", "openh264", "libvpx"].some((name) => normalized.includes(name));
}

function stateDescription(input: {
  activeCodec: VideoCodec | null;
  encodeFps: number | null;
  encoderImplementation: string | null;
  maxFps: number;
  pressure: PressureState;
  scale: number;
  sourceFps: number | null;
}): string {
  const fps = Math.round(input.encodeFps ?? input.sourceFps ?? 0);
  const cadence = `${fps}/${Math.round(input.maxFps)} FPS`;
  const detail = `${resolutionPercent(input.scale)}% resolution`;
  if (input.pressure.receiver) {
    return `balanced · viewer decode limited · ${cadence} · ${detail}`;
  }
  if (input.pressure.capture) {
    return `balanced · capture pipeline limited · ${cadence} · ${detail}`;
  }
  if (input.pressure.compute) {
    const software = input.encoderImplementation?.toLowerCase().includes("libaom")
      ? "software AV1 encoder"
      : "encoder";
    return `balanced · ${software} limited · ${cadence} · ${detail}`;
  }
  if (input.pressure.network) {
    return `balanced · network limited · ${cadence} · ${detail}`;
  }
  if (input.sourceFps !== null && input.sourceFps < input.maxFps * 0.85) {
    return `balanced · browser capture limited · ${cadence} · ${detail}`;
  }
  const codec = input.activeCodec?.replace("video/", "") ?? "video";
  return `balanced · ${codec} stable · ${cadence} · ${detail}`;
}

export class BalancedMediaController {
  #pressureSamples = 0;
  #stableSamples = 0;
  #stallSamples = 0;
  #capacitySamples = 0;
  #networkDistressSamples = 0;
  #cooldownSamples = 0;
  #capacityEstimate: number | null = null;
  #lastCodec: VideoCodec | null = null;
  #preferredCodecStableSamples = 0;
  #preferredCodecRetrySamples = 0;
  #codecRetryWindow = INITIAL_CODEC_RETRY_SAMPLES;
  #preferredCodecProbe = false;

  reset(): void {
    this.#pressureSamples = 0;
    this.#stableSamples = 0;
    this.#stallSamples = 0;
    this.#capacitySamples = 0;
    this.#networkDistressSamples = 0;
    this.#cooldownSamples = 0;
    this.#capacityEstimate = null;
    this.#lastCodec = null;
    this.#preferredCodecStableSamples = 0;
    this.#preferredCodecRetrySamples = 0;
    this.#codecRetryWindow = INITIAL_CODEC_RETRY_SAMPLES;
    this.#preferredCodecProbe = false;
  }

  observe(
    summary: StatisticsSummary,
    settings: BalancedControllerSettings,
    peerSummary: StatisticsSummary | null = null,
  ): BalancedControllerAction {
    if (this.#cooldownSamples > 0) {
      this.#cooldownSamples -= 1;
    }
    if (this.#preferredCodecRetrySamples > 0) {
      this.#preferredCodecRetrySamples -= 1;
    }

    const activeCodec = settings.activeCodec ?? codecFromSummary(summary);
    this.#observeCodecTransition(activeCodec, settings.preferredCodec);
    const sourceFpsValue = Math.max(summary.previewFps ?? 0, summary.captureFps ?? 0);
    const sourceFps = sourceFpsValue > 0 ? sourceFpsValue : null;
    const encodeFps = summary.encodeFps;
    const expectedFps = settings.maxFps;
    const frameBudgetMs = 1_000 / Math.max(1, expectedFps);
    const receiverFps = peerSummary?.decodeFps ?? null;
    const measuredFps = positiveNumbers([encodeFps, receiverFps]);
    const effectiveFps = measuredFps.length > 0 ? Math.min(...measuredFps) : null;
    const cadence = encodeFps !== null && encodeFps < expectedFps * 0.88;
    const capturePipelineLimited =
      sourceFps !== null &&
      encodeFps !== null &&
      sourceFps < expectedFps * 0.88 &&
      encodeFps >= sourceFps * 0.75 &&
      encodeFps <= sourceFps * 1.12 &&
      (summary.actualBitrateBps ?? 0) > settings.maxBitrateBps * 0.18;
    const compute =
      summary.qualityLimitationReason === "cpu" ||
      (summary.encodeTimeMsPerFrame !== null &&
        summary.encodeTimeMsPerFrame > frameBudgetMs * 0.82);
    const network =
      summary.qualityLimitationReason === "bandwidth" ||
      (summary.packetSendDelayMsPerPacket ?? 0) > 12 ||
      Math.max(summary.packetLossPercent ?? 0, peerSummary?.packetLossPercent ?? 0) > 1.5 ||
      (peerSummary?.jitterMs ?? 0) > 25;
    const networkDistress =
      (summary.packetSendDelayMsPerPacket ?? 0) > 20 ||
      Math.max(summary.packetLossPercent ?? 0, peerSummary?.packetLossPercent ?? 0) > 2 ||
      (peerSummary?.jitterMs ?? 0) > 35;
    this.#networkDistressSamples = networkDistress ? this.#networkDistressSamples + 1 : 0;
    const receiver =
      receiverFps !== null &&
      encodeFps !== null &&
      encodeFps >= expectedFps * 0.82 &&
      receiverFps < encodeFps * 0.78 &&
      (peerSummary?.decodeTimeMsPerFrame ?? 0) > frameBudgetMs * 0.82;
    const severe =
      (encodeFps !== null && encodeFps < expectedFps * 0.6) ||
      (summary.encodeTimeMsPerFrame ?? 0) > frameBudgetMs * 1.35;
    const pressure: PressureState = {
      capture: capturePipelineLimited,
      compute,
      network,
      receiver,
      severe,
    };
    const stalled =
      summary.mediaFlowState === "stalled" &&
      (summary.transportState === "connected" || summary.dtlsState === "connected");

    this.#stallSamples = stalled ? this.#stallSamples + 1 : 0;
    if (this.#stallSamples >= STALL_SAMPLES && this.#cooldownSamples === 0) {
      this.#afterAdjustment();
      return { type: "restart", state: "balanced · recovering stalled sender" };
    }

    const underPressure = (cadence && (capturePipelineLimited || compute || network)) || receiver;
    this.#pressureSamples = underPressure ? this.#pressureSamples + 1 : 0;
    const lowComplexity =
      ((summary.qpAverage ?? 99) <= 18 &&
        (summary.actualBitrateBps ?? settings.maxBitrateBps) < settings.maxBitrateBps * 0.22) ||
      (summary.actualBitrateBps ?? settings.maxBitrateBps) < settings.maxBitrateBps * 0.12;
    const stable =
      summary.mediaFlowState === "flowing" &&
      !compute &&
      !network &&
      !receiver &&
      ((encodeFps !== null && encodeFps >= expectedFps * 0.9) || lowComplexity);
    this.#stableSamples = stable ? this.#stableSamples + 1 : 0;

    const pressureReady =
      (severe && (compute || network || receiver)) || this.#pressureSamples >= PRESSURE_SAMPLES;
    if (pressureReady && this.#cooldownSamples === 0) {
      const preferredIsActive =
        settings.preferredCodec !== undefined && activeCodec === settings.preferredCodec;
      const maximumScale =
        preferredIsActive && settings.fallbackCodec ? PREFERRED_CODEC_SCALE_LIMIT : 4;
      const scale = pressureScale(
        settings.scaleResolutionDownBy,
        expectedFps,
        effectiveFps,
        maximumScale,
      );
      if (scale !== null) {
        this.#afterAdjustment();
        return {
          type: "scale",
          scaleResolutionDownBy: scale,
          state: `balanced · preserving ${Math.round(expectedFps)} FPS at ${resolutionPercent(scale)}% resolution`,
        };
      }
      if (
        compute &&
        softwareEncoder(summary.encoderImplementation) &&
        settings.fallbackCodec &&
        settings.fallbackCodec !== activeCodec &&
        settings.scaleResolutionDownBy >= PREFERRED_CODEC_SCALE_LIMIT - 0.01
      ) {
        this.#afterAdjustment();
        return {
          type: "codec",
          codec: settings.fallbackCodec,
          state: `balanced · temporary codec recovery after reaching ${resolutionPercent(settings.scaleResolutionDownBy)}% resolution`,
        };
      }
    }

    const capacity = pathCapacity(summary, peerSummary);
    if (capacity !== null) {
      this.#capacityEstimate =
        this.#capacityEstimate === null
          ? capacity
          : this.#capacityEstimate * 0.75 + capacity * 0.25;
    }
    const capacityAction = this.#bitrateAction(settings);
    if (capacityAction) {
      return capacityAction;
    }

    const preferredCodec = settings.preferredCodec;
    if (
      preferredCodec &&
      activeCodec &&
      activeCodec !== preferredCodec &&
      this.#preferredCodecRetrySamples === 0
    ) {
      this.#preferredCodecStableSamples = stable ? this.#preferredCodecStableSamples + 1 : 0;
      if (this.#preferredCodecStableSamples >= PREFERRED_CODEC_RECOVERY_SAMPLES) {
        this.#preferredCodecProbe = true;
        this.#preferredCodecStableSamples = 0;
        this.#afterAdjustment();
        return {
          type: "codec",
          codec: preferredCodec,
          state: `balanced · retrying preferred ${preferredCodec.replace("video/", "")} codec`,
        };
      }
    } else if (activeCodec === preferredCodec && stable) {
      this.#preferredCodecStableSamples += 1;
      if (this.#preferredCodecStableSamples >= PREFERRED_CODEC_RECOVERY_SAMPLES) {
        this.#preferredCodecProbe = false;
        this.#codecRetryWindow = INITIAL_CODEC_RETRY_SAMPLES;
      }
    } else {
      this.#preferredCodecStableSamples = 0;
    }

    if (this.#stableSamples >= RECOVERY_SAMPLES && this.#cooldownSamples === 0) {
      const scale = nextScale(settings.scaleResolutionDownBy, -1);
      if (scale !== null) {
        this.#afterAdjustment();
        return {
          type: "scale",
          scaleResolutionDownBy: scale,
          state: `balanced · restoring detail to ${resolutionPercent(scale)}% resolution`,
        };
      }
    }

    return {
      type: "none",
      state: stateDescription({
        activeCodec,
        encodeFps,
        encoderImplementation: summary.encoderImplementation,
        maxFps: expectedFps,
        pressure,
        scale: settings.scaleResolutionDownBy,
        sourceFps,
      }),
    };
  }

  #bitrateAction(settings: BalancedControllerSettings): BalancedControllerAction | null {
    if (!settings.automaticBitrate || this.#capacityEstimate === null) {
      this.#capacitySamples = 0;
      return null;
    }
    const ceiling = settings.bitrateCeilingBps ?? 100_000_000;
    const safeCapacity = Math.min(ceiling, this.#capacityEstimate * 0.9);
    const tooHigh =
      settings.maxBitrateBps > safeCapacity * 1.25 &&
      this.#networkDistressSamples >= NETWORK_DISTRESS_SAMPLES;
    const canRaise = settings.maxBitrateBps < safeCapacity * 0.88;
    this.#capacitySamples = tooHigh || canRaise ? this.#capacitySamples + 1 : 0;
    if (this.#capacitySamples < CAPACITY_SAMPLES || this.#cooldownSamples > 0) {
      return null;
    }
    const proposed = tooHigh
      ? Math.max(2_000_000, safeCapacity)
      : Math.min(safeCapacity, settings.maxBitrateBps * 1.25);
    const rounded = Math.round(proposed / 250_000) * 250_000;
    if (Math.abs(rounded - settings.maxBitrateBps) < 500_000) {
      return null;
    }
    this.#afterAdjustment();
    return {
      type: "bitrate",
      maxBitrateBps: rounded,
      state: tooHigh
        ? `balanced · pacing within ${(safeCapacity / 1_000_000).toFixed(1)} Mbps path capacity`
        : `balanced · expanding quality ceiling to ${(rounded / 1_000_000).toFixed(1)} Mbps`,
    };
  }

  #observeCodecTransition(activeCodec: VideoCodec | null, preferredCodec?: VideoCodec): void {
    if (!activeCodec || activeCodec === this.#lastCodec) {
      return;
    }
    if (this.#lastCodec === preferredCodec && activeCodec !== preferredCodec) {
      if (this.#preferredCodecProbe) {
        this.#codecRetryWindow = Math.min(MAX_CODEC_RETRY_SAMPLES, this.#codecRetryWindow * 2);
      }
      this.#preferredCodecRetrySamples = this.#codecRetryWindow;
      this.#preferredCodecStableSamples = 0;
      this.#preferredCodecProbe = false;
    } else if (activeCodec === preferredCodec && this.#lastCodec !== null) {
      this.#preferredCodecProbe = true;
      this.#preferredCodecStableSamples = 0;
    }
    this.#lastCodec = activeCodec;
  }

  #afterAdjustment(): void {
    this.#pressureSamples = 0;
    this.#stableSamples = 0;
    this.#stallSamples = 0;
    this.#capacitySamples = 0;
    this.#cooldownSamples = ADJUSTMENT_COOLDOWN_SAMPLES;
  }
}
