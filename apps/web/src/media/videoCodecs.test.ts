import { describe, expect, it } from "bun:test";
import { supportedVideoCodecs } from "./videoCodecs.js";

describe("browser video codec capability normalization", () => {
  it("normalizes codec aliases and returns the project preference order", () => {
    expect(
      supportedVideoCodecs([
        { mimeType: "video/H264" },
        { mimeType: "video/HEVC" },
        { mimeType: "video/rtx" },
        { mimeType: "video/AV1" },
      ]),
    ).toEqual(["video/AV1", "video/H265", "video/H264"]);
  });

  it("deduplicates multiple codec profiles", () => {
    expect(supportedVideoCodecs([{ mimeType: "video/H264" }, { mimeType: "video/h264" }])).toEqual([
      "video/H264",
    ]);
  });
});
