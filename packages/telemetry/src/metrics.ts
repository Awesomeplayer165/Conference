export interface PercentileSummary {
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  if (quantile < 0 || quantile > 1) {
    throw new RangeError("quantile must be between 0 and 1");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];
  if (lowerValue === undefined || upperValue === undefined) {
    return null;
  }
  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

export function computePercentiles(values: readonly number[]): PercentileSummary {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

export function optionalMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatMetric(value: number | string | null | undefined, suffix = ""): string {
  return value === null || value === undefined ? "Unavailable" : `${value}${suffix}`;
}
