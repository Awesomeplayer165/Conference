import type { StatisticsSummary, VideoCodec } from "@conference/protocol";

const KEYFRAME_RECOVERY_SAMPLES = 3;
const CODEC_FALLBACK_SAMPLES = 7;
const LOW_LATENCY_STABLE_SAMPLES = 2;

export interface ReceiverRecoveryInput {
  compatibleVideoCodecs: readonly VideoCodec[];
  consumerId: string | null;
  selectedVideoCodec: VideoCodec | null;
  summary: StatisticsSummary;
  videoHasCurrentData: boolean;
}

export type ReceiverRecoveryAction =
  | { type: "none"; state: string }
  | { type: "keyframe"; state: string }
  | { type: "fallback"; codec: VideoCodec; state: string }
  | { type: "low-latency"; state: string };

function receiverIsFailing(input: ReceiverRecoveryInput): boolean {
  return (
    !input.videoHasCurrentData ||
    input.summary.mediaFlowState === "RTP packets without complete frames" ||
    input.summary.mediaFlowState === "stalled"
  );
}

export class ReceiverRecoveryController {
  #consumerId: string | null = null;
  #failureSamples = 0;
  #stableSamples = 0;
  #keyframeRequested = false;
  #fallbackRequested = false;
  #lowLatencyApplied = false;

  reset(): void {
    this.#consumerId = null;
    this.#failureSamples = 0;
    this.#stableSamples = 0;
    this.#keyframeRequested = false;
    this.#fallbackRequested = false;
    this.#lowLatencyApplied = false;
  }

  observe(input: ReceiverRecoveryInput): ReceiverRecoveryAction {
    if (!input.consumerId) {
      this.reset();
      return { type: "none", state: "receiver · waiting for media" };
    }
    if (input.consumerId !== this.#consumerId) {
      this.reset();
      this.#consumerId = input.consumerId;
    }

    if (!receiverIsFailing(input)) {
      this.#failureSamples = 0;
      this.#keyframeRequested = false;
      this.#stableSamples += 1;
      if (
        !this.#lowLatencyApplied &&
        this.#stableSamples >= LOW_LATENCY_STABLE_SAMPLES &&
        (input.summary.framesDecoded ?? 0) > 0
      ) {
        this.#lowLatencyApplied = true;
        return { type: "low-latency", state: "receiver · low-latency playout active" };
      }
      return { type: "none", state: "receiver · media flowing" };
    }

    this.#stableSamples = 0;
    this.#failureSamples += 1;
    if (!this.#keyframeRequested && this.#failureSamples >= KEYFRAME_RECOVERY_SAMPLES) {
      this.#keyframeRequested = true;
      this.#lowLatencyApplied = false;
      return { type: "keyframe", state: "receiver · requesting a clean video frame" };
    }
    if (
      !this.#fallbackRequested &&
      this.#failureSamples >= CODEC_FALLBACK_SAMPLES &&
      input.selectedVideoCodec === "video/AV1" &&
      input.compatibleVideoCodecs.includes("video/H264")
    ) {
      this.#fallbackRequested = true;
      return {
        type: "fallback",
        codec: "video/H264",
        state: "receiver · selecting a compatible decoder",
      };
    }
    return {
      type: "none",
      state: input.videoHasCurrentData
        ? "receiver · recovering media flow"
        : "receiver · waiting for the first decoded frame",
    };
  }
}
