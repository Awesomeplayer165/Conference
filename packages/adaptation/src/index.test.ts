import { describe, expect, it } from "bun:test";
import { createInitialDecision } from "./index.js";

describe("adaptation contract", () => {
  it("starts at native scale without claiming a bitrate target", () => {
    expect(createInitialDecision("detail")).toMatchObject({
      targetVideoBitrateBps: null,
      maxFramerate: null,
      scaleResolutionDownBy: 1,
      contentMode: "detail",
      state: "probing",
      repairHeadroomBps: 0,
    });
  });
});
