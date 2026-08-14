import { describe, expect, it } from "bun:test";
import {
  compatibleVideoCodecs,
  ROUTER_VIDEO_CODEC_PREFERENCE,
  routedVideoCodec,
  selectVideoCodec,
} from "./videoCodecs.js";

describe("Stage 3 video codec selection", () => {
  it("normalizes the actual producer codec sent to the viewer", () => {
    expect(routedVideoCodec("video/av1")).toBe("video/AV1");
    expect(routedVideoCodec("video/H264")).toBe("video/H264");
    expect(routedVideoCodec("video/H265")).toBeNull();
  });
  it("prefers AV1 over H.264 when the host and viewer share it", () => {
    expect(
      selectVideoCodec(
        { send: ["video/H264", "video/AV1"], receive: ["video/H264"] },
        { send: ["video/H264"], receive: ["video/H264", "video/AV1"] },
      ),
    ).toBe("video/AV1");
  });

  it("falls back to H.264 when AV1 is not in the end-to-end intersection", () => {
    expect(
      selectVideoCodec(
        { send: ["video/AV1", "video/H264"], receive: ["video/H264"] },
        { send: ["video/H264"], receive: ["video/H264"] },
      ),
    ).toBe("video/H264");
  });

  it("reports every router-supported fallback shared by both endpoints", () => {
    expect(
      compatibleVideoCodecs(
        { send: ["video/AV1", "video/H264"], receive: ["video/H264"] },
        { send: ["video/H264"], receive: ["video/H264", "video/AV1"] },
      ),
    ).toEqual(["video/AV1", "video/H264"]);
  });

  it("does not select H.265 while the mediasoup worker cannot route it", () => {
    expect(ROUTER_VIDEO_CODEC_PREFERENCE).not.toContain("video/H265");
    expect(
      selectVideoCodec(
        { send: ["video/H265"], receive: ["video/H265"] },
        { send: ["video/H265"], receive: ["video/H265"] },
      ),
    ).toBeNull();
  });
});
