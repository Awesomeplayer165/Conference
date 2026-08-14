import { describe, expect, it } from "bun:test";
import { createEmptyStatisticsSummary } from "@conference/protocol";
import { describeEncoderPath } from "./encoderPath.js";

describe("encoder path description", () => {
  it("identifies Chromium's software AV1 encoder", () => {
    expect(
      describeEncoderPath({
        ...createEmptyStatisticsSummary(),
        encoderImplementation: "libaom",
        encoderCapabilityPowerEfficient: false,
      }),
    ).toBe("Software · libaom");
  });

  it("identifies OpenH264 as software even if a capability probe was optimistic", () => {
    expect(
      describeEncoderPath({
        ...createEmptyStatisticsSummary(),
        encoderImplementation: "OpenH264",
        encoderCapabilityPowerEfficient: true,
      }),
    ).toBe("Software · OpenH264");
  });

  it("identifies a Chromium external hardware encoder", () => {
    expect(
      describeEncoderPath({
        ...createEmptyStatisticsSummary(),
        encoderImplementation: "ExternalEncoder",
      }),
    ).toBe("Hardware · ExternalEncoder");
  });

  it("uses the actual WebRTC power-efficiency measurement when exposed", () => {
    expect(
      describeEncoderPath({
        ...createEmptyStatisticsSummary(),
        encoderPowerEfficient: true,
      }),
    ).toBe("Hardware-efficient");
  });
});
