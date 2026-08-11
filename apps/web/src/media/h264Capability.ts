export interface H264EncodingCapability {
  requiredLevel: string | null;
  supported: boolean | null;
  smooth: boolean | null;
  powerEfficient: boolean | null;
}

interface H264LevelLimit {
  level: string;
  maxMacroblocksPerFrame: number;
  maxMacroblocksPerSecond: number;
}

const H264_LEVEL_LIMITS: readonly H264LevelLimit[] = [
  { level: "1", maxMacroblocksPerFrame: 99, maxMacroblocksPerSecond: 1_485 },
  { level: "1.1", maxMacroblocksPerFrame: 396, maxMacroblocksPerSecond: 3_000 },
  { level: "1.2", maxMacroblocksPerFrame: 396, maxMacroblocksPerSecond: 6_000 },
  { level: "1.3", maxMacroblocksPerFrame: 396, maxMacroblocksPerSecond: 11_880 },
  { level: "2", maxMacroblocksPerFrame: 396, maxMacroblocksPerSecond: 11_880 },
  { level: "2.1", maxMacroblocksPerFrame: 792, maxMacroblocksPerSecond: 19_800 },
  { level: "2.2", maxMacroblocksPerFrame: 1_620, maxMacroblocksPerSecond: 20_250 },
  { level: "3", maxMacroblocksPerFrame: 1_620, maxMacroblocksPerSecond: 40_500 },
  { level: "3.1", maxMacroblocksPerFrame: 3_600, maxMacroblocksPerSecond: 108_000 },
  { level: "3.2", maxMacroblocksPerFrame: 5_120, maxMacroblocksPerSecond: 216_000 },
  { level: "4", maxMacroblocksPerFrame: 8_192, maxMacroblocksPerSecond: 245_760 },
  { level: "4.1", maxMacroblocksPerFrame: 8_192, maxMacroblocksPerSecond: 245_760 },
  { level: "4.2", maxMacroblocksPerFrame: 8_704, maxMacroblocksPerSecond: 522_240 },
  { level: "5", maxMacroblocksPerFrame: 22_080, maxMacroblocksPerSecond: 589_824 },
  { level: "5.1", maxMacroblocksPerFrame: 36_864, maxMacroblocksPerSecond: 983_040 },
  { level: "5.2", maxMacroblocksPerFrame: 36_864, maxMacroblocksPerSecond: 2_073_600 },
];

export function requiredH264Level(width: number, height: number, fps: number): string | null {
  if (![width, height, fps].every((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }
  const macroblocksPerFrame = Math.ceil(width / 16) * Math.ceil(height / 16);
  const macroblocksPerSecond = macroblocksPerFrame * fps;
  return (
    H264_LEVEL_LIMITS.find(
      (limit) =>
        macroblocksPerFrame <= limit.maxMacroblocksPerFrame &&
        macroblocksPerSecond <= limit.maxMacroblocksPerSecond,
    )?.level ?? null
  );
}

type WebRtcEncodingConfiguration = {
  type: "webrtc";
  video: {
    contentType: string;
    width: number;
    height: number;
    bitrate: number;
    framerate: number;
  };
};

type WebRtcMediaCapabilities = {
  encodingInfo: (configuration: WebRtcEncodingConfiguration) => Promise<{
    supported: boolean;
    smooth: boolean;
    powerEfficient: boolean;
  }>;
};

export async function probeH264EncodingCapability(input: {
  width: number;
  height: number;
  fps: number;
  bitrateBps: number;
}): Promise<H264EncodingCapability> {
  const requiredLevel = requiredH264Level(input.width, input.height, input.fps);
  const capabilities = navigator.mediaCapabilities as unknown as
    | WebRtcMediaCapabilities
    | undefined;
  if (!capabilities?.encodingInfo) {
    return { requiredLevel, supported: null, smooth: null, powerEfficient: null };
  }
  try {
    const result = await capabilities.encodingInfo({
      type: "webrtc",
      video: {
        contentType:
          "video/H264;level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
        width: Math.round(input.width),
        height: Math.round(input.height),
        bitrate: Math.round(input.bitrateBps),
        framerate: input.fps,
      },
    });
    return {
      requiredLevel,
      supported: result.supported,
      smooth: result.smooth,
      powerEfficient: result.powerEfficient,
    };
  } catch {
    return { requiredLevel, supported: null, smooth: null, powerEfficient: null };
  }
}
