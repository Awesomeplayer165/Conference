import type { Consumer } from "mediasoup-client/types";

const MOTION_JITTER_BUFFER_TARGET_MS = 40;

interface LowLatencyReceiver {
  jitterBufferTarget?: number;
  playoutDelayHint?: number;
}

export function applyLowLatencyReceiverPolicy(consumer: Consumer): {
  accepted: boolean;
  jitterBufferTargetMs: number | null;
} {
  const receiver = consumer.rtpReceiver as unknown as LowLatencyReceiver | undefined;
  if (!receiver) {
    return { accepted: true, jitterBufferTargetMs: null };
  }
  try {
    if ("jitterBufferTarget" in receiver) {
      receiver.jitterBufferTarget = MOTION_JITTER_BUFFER_TARGET_MS;
      return { accepted: true, jitterBufferTargetMs: receiver.jitterBufferTarget ?? null };
    }
    if ("playoutDelayHint" in receiver) {
      receiver.playoutDelayHint = MOTION_JITTER_BUFFER_TARGET_MS / 1_000;
      return { accepted: true, jitterBufferTargetMs: MOTION_JITTER_BUFFER_TARGET_MS };
    }
    return { accepted: true, jitterBufferTargetMs: null };
  } catch {
    return { accepted: false, jitterBufferTargetMs: null };
  }
}
