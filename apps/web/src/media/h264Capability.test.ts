import { describe, expect, it } from "bun:test";
import { requiredH264Level } from "./h264Capability.js";

describe("H.264 level diagnostics", () => {
  it("reports the minimum level for arbitrary source geometry and FPS", () => {
    expect(requiredH264Level(1_920, 1_080, 30)).toBe("4");
    expect(requiredH264Level(1_920, 1_080, 60)).toBe("4.2");
    expect(requiredH264Level(3_024, 1_964, 60)).toBe("5.2");
  });

  it("rejects invalid geometry instead of inventing a level", () => {
    expect(requiredH264Level(0, 1_080, 60)).toBeNull();
    expect(requiredH264Level(1_920, Number.NaN, 60)).toBeNull();
  });
});
