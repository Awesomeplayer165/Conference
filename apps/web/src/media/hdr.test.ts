import { describe, expect, it } from "bun:test";
import { classifyHdrTransfer, describeHdrPath, UNKNOWN_HDR_METADATA } from "./hdr.js";

describe("HDR metadata", () => {
  it("recognizes the standard PQ and HLG transfer functions", () => {
    expect(classifyHdrTransfer("smpteSt2084")).toBe("hdr-pq");
    expect(classifyHdrTransfer("arib-std-b67")).toBe("hdr-hlg");
    expect(classifyHdrTransfer("bt709")).toBe("sdr");
  });

  it("does not claim HDR preservation without decoded-frame evidence", () => {
    expect(
      describeHdrPath({
        source: { ...UNKNOWN_HDR_METADATA, mode: "hdr-pq", passthroughRequested: true },
        decoded: null,
        codec: "video/AV1",
        display: { highDynamicRange: true, rec2020: true, p3: true, dynamicRangeLimit: true },
      }),
    ).toBe("HDR source · preservation unverified");
  });
});
