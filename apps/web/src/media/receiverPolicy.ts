import type { Consumer } from "mediasoup-client/types";

export const MOTION_JITTER_BUFFER_TARGET_MS = 40;

interface LowLatencyReceiver {
  jitterBufferTarget?: number | null;
  playoutDelayHint?: number | null;
}

export interface ReceiverBufferPolicyResult {
  accepted: boolean;
  jitterBufferTargetMs: number | null;
}

function configureReceiverBuffer(
  consumer: Consumer,
  targetMs: number | null,
): ReceiverBufferPolicyResult {
  const receiver = consumer.rtpReceiver as unknown as LowLatencyReceiver | undefined;
  if (!receiver) {
    return { accepted: true, jitterBufferTargetMs: null };
  }
  try {
    if ("jitterBufferTarget" in receiver) {
      receiver.jitterBufferTarget = targetMs;
      return { accepted: true, jitterBufferTargetMs: receiver.jitterBufferTarget ?? null };
    }
    if ("playoutDelayHint" in receiver) {
      receiver.playoutDelayHint = targetMs === null ? null : targetMs / 1_000;
      return { accepted: true, jitterBufferTargetMs: targetMs };
    }
    return { accepted: true, jitterBufferTargetMs: null };
  } catch {
    return { accepted: false, jitterBufferTargetMs: null };
  }
}

/** Keep startup adaptive so a large first keyframe cannot miss an artificial playout deadline. */
export function applyAdaptiveReceiverPolicy(consumer: Consumer): ReceiverBufferPolicyResult {
  return configureReceiverBuffer(consumer, null);
}

/** Tighten playout only after the browser has decoded consecutive frames. */
export function applyLowLatencyReceiverPolicy(consumer: Consumer): ReceiverBufferPolicyResult {
  return configureReceiverBuffer(consumer, MOTION_JITTER_BUFFER_TARGET_MS);
}
