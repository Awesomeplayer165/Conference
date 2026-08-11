import type { ContentMode } from "@conference/protocol";

export type ControllerState = "probing" | "stabilizing" | "backoff" | "recovery" | "emergency";

export interface AdaptiveControllerInput {
  timestampMs: number;
  hostAvailableOutgoingBitrateBps: number | null;
  viewerAvailableIncomingBitrateBps: number | null;
  actualSendBitrateBps: number | null;
  rttMs: number | null;
  minimumRttMs: number | null;
  packetLossPercent: number | null;
  jitterMs: number | null;
  nackRate: number | null;
  retransmissionRate: number | null;
  captureFps: number | null;
  encodeFps: number | null;
  presentationFps: number | null;
  droppedFrames: number | null;
  qpAverage: number | null;
  freezeDurationMs: number | null;
}

export interface AdaptiveControllerDecision {
  targetVideoBitrateBps: number | null;
  maxFramerate: number | null;
  scaleResolutionDownBy: number;
  contentMode: ContentMode;
  state: ControllerState;
  reason: string;
  holdUntilMs: number;
  repairHeadroomBps: number;
}

export function createInitialDecision(
  contentMode: ContentMode = "auto",
): AdaptiveControllerDecision {
  return {
    targetVideoBitrateBps: null,
    maxFramerate: null,
    scaleResolutionDownBy: 1,
    contentMode,
    state: "probing",
    reason: "Stage 0 contract: awaiting measured inputs",
    holdUntilMs: 0,
    repairHeadroomBps: 0,
  };
}
