import { describe, expect, it } from "bun:test";
import { loadHostMediaSettings, saveHostMediaSettings } from "./hostSettings.js";

describe("host media settings", () => {
  it("persists FPS and bitrate ceilings", () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    saveHostMediaSettings(
      {
        maxFps: 120,
        maxBitrateBps: 71_250_000,
        contentMode: "motion",
        fpsUserEdited: true,
        bitrateUserEdited: true,
        hdrEnabled: false,
        audioEnabled: false,
      },
      storage,
    );

    expect(loadHostMediaSettings(storage)).toEqual({
      maxFps: 120,
      maxBitrateBps: 71_250_000,
      contentMode: "auto",
      fpsUserEdited: true,
      bitrateUserEdited: true,
      hdrEnabled: false,
      audioEnabled: false,
    });
  });
});
