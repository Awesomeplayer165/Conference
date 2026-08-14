export interface H264EncodingCapability {
  requiredLevel: string | null;
  supported: boolean | null;
  smooth: boolean | null;
  powerEfficient: boolean | null;
}

interface H264LevelLimit {
  idc: string;
  level: string;
  maxMacroblocksPerFrame: number;
  maxMacroblocksPerSecond: number;
}

const H264_LEVEL_LIMITS: readonly H264LevelLimit[] = [
  { level: "1", idc: "0a", maxMacroblocksPerFrame: 99, maxMacroblocksPerSecond: 1_485 },
  { level: "1.1", idc: "0b", maxMacroblocksPerFrame: 396, maxMacroblocksPerSecond: 3_000 },
  { level: "1.2", idc: "0c", maxMacroblocksPerFrame: 396, maxMacroblocksPerSecond: 6_000 },
  { level: "1.3", idc: "0d", maxMacroblocksPerFrame: 396, maxMacroblocksPerSecond: 11_880 },
  { level: "2", idc: "14", maxMacroblocksPerFrame: 396, maxMacroblocksPerSecond: 11_880 },
  { level: "2.1", idc: "15", maxMacroblocksPerFrame: 792, maxMacroblocksPerSecond: 19_800 },
  { level: "2.2", idc: "16", maxMacroblocksPerFrame: 1_620, maxMacroblocksPerSecond: 20_250 },
  { level: "3", idc: "1e", maxMacroblocksPerFrame: 1_620, maxMacroblocksPerSecond: 40_500 },
  { level: "3.1", idc: "1f", maxMacroblocksPerFrame: 3_600, maxMacroblocksPerSecond: 108_000 },
  { level: "3.2", idc: "20", maxMacroblocksPerFrame: 5_120, maxMacroblocksPerSecond: 216_000 },
  { level: "4", idc: "28", maxMacroblocksPerFrame: 8_192, maxMacroblocksPerSecond: 245_760 },
  { level: "4.1", idc: "29", maxMacroblocksPerFrame: 8_192, maxMacroblocksPerSecond: 245_760 },
  { level: "4.2", idc: "2a", maxMacroblocksPerFrame: 8_704, maxMacroblocksPerSecond: 522_240 },
  { level: "5", idc: "32", maxMacroblocksPerFrame: 22_080, maxMacroblocksPerSecond: 589_824 },
  { level: "5.1", idc: "33", maxMacroblocksPerFrame: 36_864, maxMacroblocksPerSecond: 983_040 },
  { level: "5.2", idc: "34", maxMacroblocksPerFrame: 36_864, maxMacroblocksPerSecond: 2_073_600 },
  { level: "6", idc: "3c", maxMacroblocksPerFrame: 139_264, maxMacroblocksPerSecond: 4_177_920 },
  { level: "6.1", idc: "3d", maxMacroblocksPerFrame: 139_264, maxMacroblocksPerSecond: 8_355_840 },
  { level: "6.2", idc: "3e", maxMacroblocksPerFrame: 139_264, maxMacroblocksPerSecond: 16_711_680 },
];

function requiredH264LevelLimit(width: number, height: number, fps: number) {
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
    ) ?? null
  );
}

export function requiredH264Level(width: number, height: number, fps: number): string | null {
  return requiredH264LevelLimit(width, height, fps)?.level ?? null;
}

export function h264BaselineProfileLevelId(width: number, height: number, fps: number): string {
  return `4200${requiredH264LevelLimit(width, height, fps)?.idc ?? "3e"}`;
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
        contentType: `video/H264;level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=${h264BaselineProfileLevelId(
          input.width,
          input.height,
          input.fps,
        )}`,
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
