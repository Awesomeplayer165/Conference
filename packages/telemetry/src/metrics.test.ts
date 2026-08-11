import { describe, expect, it } from "bun:test";
import { computePercentiles, formatMetric, optionalMetric, percentile } from "./metrics.js";

describe("telemetry metrics", () => {
  it("computes interpolated percentiles without mutating input", () => {
    const values = [4, 1, 3, 2];
    expect(percentile(values, 0.5)).toBe(2.5);
    const summary = computePercentiles(values);
    expect(summary.p50).toBe(2.5);
    expect(summary.p95).toBeCloseTo(3.85);
    expect(summary.p99).toBeCloseTo(3.97);
    expect(values).toEqual([4, 1, 3, 2]);
  });

  it("keeps unsupported values distinct from zero", () => {
    expect(optionalMetric(undefined)).toBeNull();
    expect(optionalMetric(0)).toBe(0);
    expect(formatMetric(null)).toBe("Unavailable");
    expect(formatMetric(0, " ms")).toBe("0 ms");
  });
});
