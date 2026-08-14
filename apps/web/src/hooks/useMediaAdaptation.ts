import type { StatisticsSummary, VideoCodec } from "@conference/protocol";
import { useCallback, useRef } from "react";
import type { DisplayCaptureSession } from "../capture/index.js";
import {
  type BalancedControllerAction,
  BalancedMediaController,
} from "../media/balancedController.js";
import type { HostMediaSettings } from "../media/hostSettings.js";
import type { MediasoupSession, ProducerSettings } from "../media/MediasoupSession.js";
import { displayVideoCodec } from "../media/videoCodecs.js";

interface MediaAdaptationOptions {
  captureRef: React.RefObject<DisplayCaptureSession | null>;
  hostSettings: HostMediaSettings;
  localStatisticsRef: React.RefObject<StatisticsSummary>;
  mediasoupRef: React.RefObject<MediasoupSession | null>;
  producerSettingsRef: React.RefObject<ProducerSettings | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  role: "host" | "viewer";
  selectedVideoCodecRef: React.RefObject<VideoCodec | null>;
  setLocalStatistics: React.Dispatch<React.SetStateAction<StatisticsSummary>>;
  setMediaStatus: React.Dispatch<React.SetStateAction<string>>;
  setSelectedVideoCodec: React.Dispatch<React.SetStateAction<VideoCodec | null>>;
}

export function useMediaAdaptation(options: MediaAdaptationOptions) {
  const controllerRef = useRef(new BalancedMediaController());
  const operationRef = useRef(false);
  const receiverRef = useRef({ stalledSamples: 0, cooldownSamples: 0 });

  const setControllerState = useCallback(
    (state: string, extra: Partial<StatisticsSummary> = {}): void => {
      options.setLocalStatistics((current) => {
        const next = { ...current, ...extra, controllerState: state };
        options.localStatisticsRef.current = next;
        return next;
      });
    },
    [options.localStatisticsRef, options.setLocalStatistics],
  );

  const applyHostAction = useCallback(
    async (action: Exclude<BalancedControllerAction, { type: "none" }>): Promise<void> => {
      const capture = options.captureRef.current;
      const session = options.mediasoupRef.current;
      const settings = options.producerSettingsRef.current;
      const selectedCodec = options.selectedVideoCodecRef.current;
      if (!capture || !session || !settings || !selectedCodec || operationRef.current) {
        return;
      }
      operationRef.current = true;
      setControllerState(action.state);
      try {
        if (action.type === "scale") {
          const next = { ...settings, scaleResolutionDownBy: action.scaleResolutionDownBy };
          options.producerSettingsRef.current = next;
          await session.updateProducerSettings(next);
        } else if (action.type === "bitrate") {
          const next = { ...settings, maxBitrateBps: action.maxBitrateBps };
          options.producerSettingsRef.current = next;
          await session.updateProducerSettings(next);
          setControllerState(action.state, { targetBitrateBps: action.maxBitrateBps });
        } else if (action.type === "codec") {
          const next = { ...settings, preferredCodec: action.codec };
          delete next.fallbackCodec;
          options.producerSettingsRef.current = next;
          await session.startProducing(capture.track, next, action.codec);
          options.setSelectedVideoCodec(action.codec);
          setControllerState(action.state, { codec: displayVideoCodec(action.codec) });
        } else {
          await session.startProducing(capture.track, settings, selectedCodec);
        }
        options.setMediaStatus("Balanced video optimization active");
      } catch (error) {
        options.setMediaStatus(
          error instanceof Error ? error.message : "Could not adapt the video stream",
        );
      } finally {
        operationRef.current = false;
      }
    },
    [
      options.captureRef,
      options.mediasoupRef,
      options.producerSettingsRef,
      options.selectedVideoCodecRef,
      options.setMediaStatus,
      options.setSelectedVideoCodec,
      setControllerState,
    ],
  );

  const observeMediaSample = useCallback(
    (summary: StatisticsSummary): void => {
      if (options.role === "viewer") {
        const receiver = receiverRef.current;
        receiver.cooldownSamples = Math.max(0, receiver.cooldownSamples - 1);
        const video = options.remoteVideoRef.current;
        const waitingForFirstFrame =
          options.mediasoupRef.current?.consumer?.track.readyState === "live" &&
          video !== null &&
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA;
        const incompleteFrames = summary.mediaFlowState === "RTP packets without complete frames";
        receiver.stalledSamples =
          waitingForFirstFrame || incompleteFrames ? receiver.stalledSamples + 1 : 0;
        if (
          receiver.stalledSamples >= 4 &&
          receiver.cooldownSamples === 0 &&
          !operationRef.current
        ) {
          operationRef.current = true;
          receiver.stalledSamples = 0;
          receiver.cooldownSamples = 12;
          options.setMediaStatus("Recovering the shared screen…");
          void options.mediasoupRef.current
            ?.restartConsuming()
            .then(() => options.setMediaStatus("Receiving shared screen"))
            .catch((error: unknown) => {
              options.setMediaStatus(
                error instanceof Error ? error.message : "Could not recover the shared screen",
              );
            })
            .finally(() => {
              operationRef.current = false;
            });
        }
        return;
      }

      const settings = options.producerSettingsRef.current;
      if (!settings) {
        return;
      }
      const action = controllerRef.current.observe(summary, {
        automaticBitrate: !options.hostSettings.bitrateUserEdited,
        maxBitrateBps: settings.maxBitrateBps,
        maxFps: settings.maxFps,
        scaleResolutionDownBy: settings.scaleResolutionDownBy ?? 1,
        ...(settings.fallbackCodec ? { fallbackCodec: settings.fallbackCodec } : {}),
      });
      if (action.type === "none") {
        if (summary.controllerState !== action.state) {
          setControllerState(action.state);
        }
        return;
      }
      void applyHostAction(action);
    },
    [
      applyHostAction,
      options.hostSettings.bitrateUserEdited,
      options.mediasoupRef,
      options.producerSettingsRef,
      options.remoteVideoRef,
      options.role,
      options.setMediaStatus,
      setControllerState,
    ],
  );

  const resetMediaAdaptation = useCallback((): void => {
    controllerRef.current.reset();
    receiverRef.current = { stalledSamples: 0, cooldownSamples: 0 };
    operationRef.current = false;
  }, []);

  return { observeMediaSample, resetMediaAdaptation };
}
