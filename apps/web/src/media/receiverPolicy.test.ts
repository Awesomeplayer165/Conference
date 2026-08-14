import { describe, expect, it } from "bun:test";
import type { Consumer } from "mediasoup-client/types";
import {
  applyAdaptiveReceiverPolicy,
  applyLowLatencyReceiverPolicy,
  MOTION_JITTER_BUFFER_TARGET_MS,
} from "./receiverPolicy.js";

function consumerWith(receiver: object): Consumer {
  return { rtpReceiver: receiver } as unknown as Consumer;
}

describe("receiver buffering policy", () => {
  it("uses browser-adaptive buffering while the first frame is pending", () => {
    const receiver = { jitterBufferTarget: 40 as number | null };
    const result = applyAdaptiveReceiverPolicy(consumerWith(receiver));

    expect(receiver.jitterBufferTarget).toBeNull();
    expect(result).toEqual({ accepted: true, jitterBufferTargetMs: null });
  });

  it("applies the motion latency target only after decode starts", () => {
    const receiver = { jitterBufferTarget: null as number | null };
    const result = applyLowLatencyReceiverPolicy(consumerWith(receiver));

    expect(receiver.jitterBufferTarget).toBe(MOTION_JITTER_BUFFER_TARGET_MS);
    expect(result.jitterBufferTargetMs).toBe(MOTION_JITTER_BUFFER_TARGET_MS);
  });

  it("falls back to playoutDelayHint when jitterBufferTarget is unavailable", () => {
    const receiver = { playoutDelayHint: 0.04 as number | null };
    applyAdaptiveReceiverPolicy(consumerWith(receiver));
    expect(receiver.playoutDelayHint).toBeNull();

    applyLowLatencyReceiverPolicy(consumerWith(receiver));
    expect(receiver.playoutDelayHint).toBe(MOTION_JITTER_BUFFER_TARGET_MS / 1_000);
  });
});
