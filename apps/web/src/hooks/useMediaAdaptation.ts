import type { StatisticsSummary, VideoCodec } from "@conference/protocol";
import { useCallback, useRef } from "react";
import type { DisplayCaptureSession } from "../capture/index.js";
import {
  type BalancedControllerAction,
  BalancedMediaController,
} from "../media/balancedController.js";
import type { HostMediaSettings } from "../media/hostSettings.js";
import type { MediasoupSession, ProducerSettings } from "../media/MediasoupSession.js";
import { ReceiverRecoveryController } from "../media/receiverRecovery.js";
import { displayVideoCodec } from "../media/videoCodecs.js";

interface MediaAdaptationOptions {
  captureRef: React.RefObject<DisplayCaptureSession | null>;
  compatibleVideoCodecs: VideoCodec[];
  hostSettings: HostMediaSettings;
  localStatisticsRef: React.RefObject<StatisticsSummary>;
  mediasoupRef: React.RefObject<MediasoupSession | null>;
  peerStatisticsRef: React.RefObject<StatisticsSummary>;
  producerSettingsRef: React.RefObject<ProducerSettings | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  role: "host" | "viewer";
  selectedVideoCodec: VideoCodec | null;
  selectedVideoCodecRef: React.RefObject<VideoCodec | null>;
  setLocalStatistics: React.Dispatch<React.SetStateAction<StatisticsSummary>>;
  setMediaStatus: React.Dispatch<React.SetStateAction<string>>;
  setSelectedVideoCodec: React.Dispatch<React.SetStateAction<VideoCodec | null>>;
}

export function useMediaAdaptation(options: MediaAdaptationOptions) {
  const controllerRef = useRef(new BalancedMediaController());
  const operationRef = useRef(false);
  const receiverRef = useRef(new ReceiverRecoveryController());

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
          await session.startProducing(capture.track, settings, action.codec);
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
        const session = options.mediasoupRef.current;
        const video = options.remoteVideoRef.current;
        const action = receiverRef.current.observe({
          compatibleVideoCodecs: options.compatibleVideoCodecs,
          consumerId: session?.consumer?.id ?? null,
          selectedVideoCodec: options.selectedVideoCodec,
          summary,
          videoHasCurrentData:
            video !== null && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
        });
        if (summary.controllerState !== action.state) {
          setControllerState(action.state);
        }
        if (action.type === "low-latency") {
          session?.applyLowLatencyReceiverPolicy();
        } else if (action.type !== "none" && session && !operationRef.current) {
          operationRef.current = true;
          options.setMediaStatus(
            action.type === "fallback"
              ? "Selecting a compatible video decoder…"
              : "Recovering the shared screen…",
          );
          const recovery =
            action.type === "fallback"
              ? session.requestCodecFallback(action.codec)
              : session.requestConsumerKeyFrame();
          void recovery
            .then(() => {
              if (action.type === "keyframe") {
                options.setMediaStatus("Waiting for a clean video frame…");
              }
            })
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
      const action = controllerRef.current.observe(
        summary,
        {
          activeCodec: options.selectedVideoCodec,
          automaticBitrate: !options.hostSettings.bitrateUserEdited,
          bitrateCeilingBps: 100_000_000,
          maxBitrateBps: settings.maxBitrateBps,
          maxFps: settings.maxFps,
          scaleResolutionDownBy: settings.scaleResolutionDownBy ?? 1,
          ...(settings.preferredCodec ? { preferredCodec: settings.preferredCodec } : {}),
          ...(settings.fallbackCodec ? { fallbackCodec: settings.fallbackCodec } : {}),
        },
        options.peerStatisticsRef.current,
      );
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
      options.compatibleVideoCodecs,
      options.hostSettings.bitrateUserEdited,
      options.mediasoupRef,
      options.peerStatisticsRef,
      options.producerSettingsRef,
      options.remoteVideoRef,
      options.role,
      options.selectedVideoCodec,
      options.setMediaStatus,
      setControllerState,
    ],
  );

  const resetMediaAdaptation = useCallback((): void => {
    controllerRef.current.reset();
    receiverRef.current.reset();
    operationRef.current = false;
  }, []);

  return { observeMediaSample, resetMediaAdaptation };
}
