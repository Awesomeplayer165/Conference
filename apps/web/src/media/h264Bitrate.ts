export interface H264BitrateInput {
  width: number;
  height: number;
  fps: number;
}

const HIGH_QUALITY_SCREEN_BITS_PER_PIXEL_FRAME = 0.1;
const MOTION_FLOOR_BITS_PER_PIXEL_FRAME = 0.035;
const MINIMUM_BITRATE_BPS = 2_000_000;
const MAXIMUM_BITRATE_BPS = 100_000_000;
const ROUNDING_STEP_BPS = 250_000;
const STARTUP_RATIO = 0.7;
const MAXIMUM_STARTUP_BITRATE_BPS = 20_000_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Produces a quality-oriented H.264 ceiling, not an expected network rate.
 * WebRTC congestion control may send substantially less.
 */
export function recommendH264BitrateBps({ width, height, fps }: H264BitrateInput): number {
  const raw = width * height * fps * HIGH_QUALITY_SCREEN_BITS_PER_PIXEL_FRAME;
  const clamped = clamp(raw, MINIMUM_BITRATE_BPS, MAXIMUM_BITRATE_BPS);
  return Math.round(clamped / ROUNDING_STEP_BPS) * ROUNDING_STEP_BPS;
}

/**
 * A conservative quality floor hint for browsers that implement Google's WebRTC
 * bitrate codec options. It is deliberately below the quality ceiling and is not
 * a bandwidth reservation; standards-only or congestion-limited browsers ignore it.
 */
export function recommendScreenMinimumBitrateBps(
  { width, height, fps }: H264BitrateInput,
  maxBitrateBps: number,
): number {
  const raw = width * height * fps * MOTION_FLOOR_BITS_PER_PIXEL_FRAME;
  const bounded = clamp(
    raw,
    MINIMUM_BITRATE_BPS,
    Math.max(MINIMUM_BITRATE_BPS, maxBitrateBps * 0.5),
  );
  return Math.min(maxBitrateBps, Math.round(bounded / ROUNDING_STEP_BPS) * ROUNDING_STEP_BPS);
}

/** Chrome-specific SDP hint expressed in kbps; other browsers may ignore it. */
export function recommendH264StartupBitrateKbps(maxBitrateBps: number): number {
  return Math.round(
    Math.min(maxBitrateBps, maxBitrateBps * STARTUP_RATIO, MAXIMUM_STARTUP_BITRATE_BPS) / 1_000,
  );
}
