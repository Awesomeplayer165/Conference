import type { Role } from "@conference/protocol";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { DisplayCaptureSession } from "../capture/index.js";
import { recommendH264BitrateBps } from "../media/h264Bitrate.js";
import type { HostMediaSettings } from "../media/hostSettings.js";
import type { ProducerSettings } from "../media/MediasoupSession.js";
import { generateSessionCode } from "../sessionCode.js";

interface SessionControlOptions {
  captureRef: RefObject<DisplayCaptureSession | null>;
  producerSettingsRef: RefObject<ProducerSettings | null>;
  roomId: string;
  setCodeCopied: Dispatch<SetStateAction<boolean>>;
  setHostSettings: Dispatch<SetStateAction<HostMediaSettings>>;
  setRole: Dispatch<SetStateAction<Role>>;
  setRoomId: Dispatch<SetStateAction<string>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
}

export function useSessionControls(options: SessionControlOptions) {
  const {
    captureRef,
    producerSettingsRef,
    roomId,
    setCodeCopied,
    setHostSettings,
    setRole,
    setRoomId,
    setStatusMessage,
  } = options;

  function chooseRole(nextRole: Role): void {
    setRole(nextRole);
    setCodeCopied(false);
    setRoomId(nextRole === "host" ? generateSessionCode() : "");
    setStatusMessage(
      nextRole === "host" ? "Create a private sharing session" : "Enter a session code to connect",
    );
  }

  function regenerateSessionCode(): void {
    setRoomId(generateSessionCode());
    setCodeCopied(false);
  }

  async function copySessionCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(roomId);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 1_500);
    } catch {
      setCodeCopied(false);
    }
  }

  function setAutomaticBitrate(automatic: boolean): void {
    setHostSettings((current) => {
      const captureSettings = captureRef.current?.report.settingsAfterConstraints;
      const automaticCeiling =
        automatic && captureSettings?.width != null && captureSettings.height != null
          ? recommendH264BitrateBps({
              width: captureSettings.width,
              height: captureSettings.height,
              fps: producerSettingsRef.current?.maxFps ?? current.maxFps,
            })
          : current.maxBitrateBps;
      return {
        ...current,
        maxBitrateBps: automaticCeiling,
        bitrateUserEdited: !automatic,
      };
    });
  }

  return { chooseRole, copySessionCode, regenerateSessionCode, setAutomaticBitrate };
}
