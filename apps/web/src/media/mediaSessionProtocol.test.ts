import { describe, expect, it } from "bun:test";
import type { RtpCapabilities } from "mediasoup-client/types";
import { findNegotiatedCodec } from "./mediaSessionProtocol.js";

describe("negotiated codec selection", () => {
  it("prefers H.264 baseline for Chromium hardware encoders", () => {
    const codecs = [
      {
        kind: "video" as const,
        mimeType: "video/H264",
        clockRate: 90_000,
        preferredPayloadType: 101,
        parameters: { "packetization-mode": 1, "profile-level-id": "42e01f" },
      },
      {
        kind: "video" as const,
        mimeType: "video/H264",
        clockRate: 90_000,
        preferredPayloadType: 102,
        parameters: { "packetization-mode": 1, "profile-level-id": "42001f" },
      },
    ] satisfies NonNullable<RtpCapabilities["codecs"]>;

    expect(findNegotiatedCodec(codecs, "video/H264")?.parameters?.["profile-level-id"]).toBe(
      "42001f",
    );
  });

  it("retains constrained-baseline compatibility when baseline is unavailable", () => {
    const codecs = [
      {
        kind: "video" as const,
        mimeType: "video/H264",
        clockRate: 90_000,
        preferredPayloadType: 101,
        parameters: { "packetization-mode": 1, "profile-level-id": "42e01f" },
      },
    ] satisfies NonNullable<RtpCapabilities["codecs"]>;

    expect(findNegotiatedCodec(codecs, "video/H264")?.parameters?.["profile-level-id"]).toBe(
      "42e01f",
    );
  });
});
