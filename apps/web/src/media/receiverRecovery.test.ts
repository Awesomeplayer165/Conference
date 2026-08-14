import { describe, expect, it } from "bun:test";
import { createEmptyStatisticsSummary } from "@conference/protocol";
import { ReceiverRecoveryController } from "./receiverRecovery.js";

function stalledInput(codec: "video/AV1" | "video/H264" = "video/AV1") {
  return {
    compatibleVideoCodecs: ["video/AV1", "video/H264"] as const,
    consumerId: "consumer-1",
    selectedVideoCodec: codec,
    summary: {
      ...createEmptyStatisticsSummary(),
      codec,
      actualBitrateBps: 20_000_000,
      framesDecoded: 0,
      mediaFlowState: "RTP packets without complete frames",
    },
    videoHasCurrentData: false,
  };
}

describe("receiver recovery", () => {
  it("requests one keyframe without replacing the consumer", () => {
    const controller = new ReceiverRecoveryController();
    expect(controller.observe(stalledInput()).type).toBe("none");
    expect(controller.observe(stalledInput()).type).toBe("none");
    expect(controller.observe(stalledInput()).type).toBe("keyframe");
    expect(controller.observe(stalledInput()).type).toBe("none");
  });

  it("falls back from undecodable AV1 to H.264 after bounded recovery", () => {
    const controller = new ReceiverRecoveryController();
    const actions = Array.from({ length: 8 }, () => controller.observe(stalledInput()));

    expect(actions.filter((action) => action.type === "keyframe")).toHaveLength(1);
    expect(actions.filter((action) => action.type === "fallback")).toEqual([
      expect.objectContaining({ type: "fallback", codec: "video/H264" }),
    ]);
  });

  it("does not request a codec that is already active", () => {
    const controller = new ReceiverRecoveryController();
    const actions = Array.from({ length: 10 }, () =>
      controller.observe(stalledInput("video/H264")),
    );
    expect(actions.some((action) => action.type === "fallback")).toBe(false);
  });

  it("enables low-latency playout only after frames decode stably", () => {
    const controller = new ReceiverRecoveryController();
    const flowing = {
      ...stalledInput(),
      summary: {
        ...createEmptyStatisticsSummary(),
        codec: "video/AV1",
        framesDecoded: 20,
        mediaFlowState: "flowing",
      },
      videoHasCurrentData: true,
    };

    expect(controller.observe(flowing).type).toBe("none");
    expect(controller.observe(flowing).type).toBe("low-latency");
  });

  it("starts a fresh recovery budget for a replacement consumer", () => {
    const controller = new ReceiverRecoveryController();
    controller.observe(stalledInput());
    controller.observe(stalledInput());
    expect(controller.observe({ ...stalledInput(), consumerId: "consumer-2" }).type).toBe("none");
  });
});
