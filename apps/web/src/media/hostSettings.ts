import type { ContentMode } from "@conference/protocol";

export interface HostMediaSettings {
  maxFps: number;
  maxBitrateBps: number;
  contentMode: ContentMode;
  fpsUserEdited: boolean;
  bitrateUserEdited: boolean;
  hdrEnabled: boolean;
  audioEnabled: boolean;
}

const STORAGE_KEY = "conference.host-media-settings.v1";
const DEFAULT_SETTINGS: HostMediaSettings = {
  maxFps: 120,
  maxBitrateBps: 50_000_000,
  contentMode: "auto",
  fpsUserEdited: false,
  bitrateUserEdited: false,
  hdrEnabled: true,
  audioEnabled: true,
};

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function loadHostMediaSettings(
  storage: Pick<Storage, "getItem"> = localStorage,
): HostMediaSettings {
  try {
    const parsed = JSON.parse(
      storage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<HostMediaSettings> | null;
    if (!parsed) {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      maxFps: finitePositive(parsed.maxFps) ?? DEFAULT_SETTINGS.maxFps,
      maxBitrateBps: finitePositive(parsed.maxBitrateBps) ?? DEFAULT_SETTINGS.maxBitrateBps,
      contentMode: "auto",
      fpsUserEdited: parsed.fpsUserEdited === true,
      bitrateUserEdited: parsed.bitrateUserEdited === true,
      hdrEnabled: parsed.hdrEnabled !== false,
      audioEnabled: parsed.audioEnabled !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveHostMediaSettings(
  settings: HostMediaSettings,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
