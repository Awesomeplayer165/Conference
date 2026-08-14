import { describe, expect, it } from "bun:test";
import type { DisplayCaptureSession } from "../capture/index.js";
import { switchHostProducerCodec } from "./hostCodecSwitch.js";
import type { MediasoupSession, ProducerSettings } from "./MediasoupSession.js";

const settings: ProducerSettings = {
  contentMode: "motion",
  maxBitrateBps: 30_000_000,
  maxFps: 60,
  minBitrateBps: 4_000_000,
  preferredCodec: "video/AV1",
  fallbackCodec: "video/H264",
};

describe("host codec switching", () => {
  it("restarts the current producer with the viewer-compatible fallback", async () => {
    const calls: unknown[][] = [];
    const session = {
      producer: { id: "producer-1" },
      startProducing: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve();
      },
    } as unknown as MediasoupSession;
    const track = {} as MediaStreamTrack;
    const capture = { track } as unknown as DisplayCaptureSession;

    const next = await switchHostProducerCodec({
      capture,
      currentProducerId: "producer-1",
      requestedCodec: "video/H264",
      session,
      settings,
    });

    expect(next?.preferredCodec).toBe("video/H264");
    expect(next?.fallbackCodec).toBeUndefined();
    expect(calls).toEqual([[track, next, "video/H264"]]);
  });

  it("ignores a stale fallback request for a replaced producer", async () => {
    const session = { producer: { id: "producer-2" } } as unknown as MediasoupSession;
    expect(
      await switchHostProducerCodec({
        capture: { track: {} } as unknown as DisplayCaptureSession,
        currentProducerId: "producer-1",
        requestedCodec: "video/H264",
        session,
        settings,
      }),
    ).toBeNull();
  });
});
