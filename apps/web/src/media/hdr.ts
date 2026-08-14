import type { HdrMetadata, HdrMode, VideoCodec } from "@conference/protocol";

interface ColorSpaceLike {
  primaries?: unknown;
  transfer?: unknown;
  matrix?: unknown;
  fullRange?: unknown;
}

interface VideoFrameLike {
  colorSpace?: ColorSpaceLike;
  close: () => void;
}

interface TrackProcessorLike {
  readable: ReadableStream<VideoFrameLike>;
}

type TrackProcessorConstructor = new (options: { track: MediaStreamTrack }) => TrackProcessorLike;

export interface HdrDisplaySupport {
  highDynamicRange: boolean;
  rec2020: boolean;
  p3: boolean;
  dynamicRangeLimit: boolean;
}

export const UNKNOWN_HDR_METADATA: HdrMetadata = {
  mode: "unknown",
  primaries: null,
  transfer: null,
  matrix: null,
  fullRange: null,
  detectionSource: "unknown",
  passthroughRequested: false,
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function classifyHdrTransfer(transfer: string | null): HdrMode {
  if (transfer === null) {
    return "unknown";
  }
  const normalized = transfer.toLowerCase();
  if (normalized.includes("2084") || normalized === "pq") {
    return "hdr-pq";
  }
  if (normalized.includes("b67") || normalized.includes("hlg")) {
    return "hdr-hlg";
  }
  return "sdr";
}

function metadataFromColorSpace(
  colorSpace: ColorSpaceLike,
  source: HdrMetadata["detectionSource"],
  passthroughRequested: boolean,
): HdrMetadata {
  const transfer = stringValue(colorSpace.transfer);
  return {
    mode: classifyHdrTransfer(transfer),
    primaries: stringValue(colorSpace.primaries),
    transfer,
    matrix: stringValue(colorSpace.matrix),
    fullRange: typeof colorSpace.fullRange === "boolean" ? colorSpace.fullRange : null,
    detectionSource: source,
    passthroughRequested,
  };
}

export function detectHdrDisplaySupport(): HdrDisplaySupport {
  const matches = (query: string) => globalThis.matchMedia?.(query).matches === true;
  return {
    highDynamicRange: matches("(video-dynamic-range: high)") || matches("(dynamic-range: high)"),
    rec2020: matches("(color-gamut: rec2020)"),
    p3: matches("(color-gamut: p3)"),
    dynamicRangeLimit: globalThis.CSS?.supports?.("dynamic-range-limit", "no-limit") === true,
  };
}

export async function inspectTrackHdr(
  track: MediaStreamTrack,
  passthroughRequested: boolean,
  timeoutMs = 800,
): Promise<HdrMetadata> {
  const rawSettings = track.getSettings() as MediaTrackSettings & ColorSpaceLike;
  const settingsMetadata = metadataFromColorSpace(
    rawSettings,
    "track-settings",
    passthroughRequested,
  );
  if (settingsMetadata.mode !== "unknown") {
    return settingsMetadata;
  }

  const Processor = (
    globalThis as typeof globalThis & {
      MediaStreamTrackProcessor?: TrackProcessorConstructor;
    }
  ).MediaStreamTrackProcessor;
  if (!Processor) {
    return { ...UNKNOWN_HDR_METADATA, passthroughRequested };
  }

  const clone = track.clone();
  const reader = new Processor({ track: clone }).readable.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (!result || result.done || !result.value) {
      return { ...UNKNOWN_HDR_METADATA, passthroughRequested };
    }
    const metadata = metadataFromColorSpace(
      result.value.colorSpace ?? {},
      "video-frame",
      passthroughRequested,
    );
    result.value.close();
    return metadata;
  } catch {
    return { ...UNKNOWN_HDR_METADATA, passthroughRequested };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    void reader.cancel().catch(() => undefined);
    clone.stop();
  }
}

export function describeHdrPath(input: {
  source: HdrMetadata | null;
  decoded: HdrMetadata | null;
  display: HdrDisplaySupport;
  codec: VideoCodec | null;
}): string {
  const { source, decoded, display, codec } = input;
  if (!source || source.mode === "unknown") {
    return "HDR source not exposed by this browser";
  }
  if (source.mode === "sdr") {
    return "SDR source";
  }
  if (!source.passthroughRequested) {
    return "HDR source · passthrough disabled";
  }
  if (codec === null) {
    return "HDR source · waiting for a compatible codec";
  }
  if (codec !== "video/AV1") {
    return "HDR source · SDR codec fallback";
  }
  if (decoded?.mode === "hdr-pq" || decoded?.mode === "hdr-hlg") {
    return display.highDynamicRange ? "HDR preserved" : "HDR decoded · display tone-maps to SDR";
  }
  if (decoded?.mode === "sdr") {
    return "HDR source · browser tone-mapped to SDR";
  }
  return display.highDynamicRange
    ? "HDR source · preservation unverified"
    : "HDR source · browser or display tone-maps to SDR";
}
