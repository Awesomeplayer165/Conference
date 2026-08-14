import {
  createEmptyStatisticsSummary,
  type HdrMetadata,
  type StatisticsSummary,
  type VideoCodec,
  type VideoCodecCapabilities,
} from "@conference/protocol";
import { formatMetric } from "@conference/telemetry/metrics";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  type DisplayCaptureReport,
  type DisplayCaptureSession,
  normalizeDisplayCaptureError,
  startDisplayCapture,
} from "../capture/index.js";
import { dimensions } from "../components/Diagnostics.js";
import type { ConnectionStatus } from "../components/ScreenShareView.js";
import { planBalancedEncoding } from "../media/codecCapability.js";
import { recommendH264BitrateBps } from "../media/h264Bitrate.js";
import { requiredH264Level } from "../media/h264Capability.js";
import { inspectTrackHdr } from "../media/hdr.js";
import type { HostMediaSettings } from "../media/hostSettings.js";
import type { MediasoupSession, ProducerSettings } from "../media/MediasoupSession.js";
import { createProducerSettings, selectProducerMaxFps } from "../media/producerPolicy.js";
import { displayVideoCodec } from "../media/videoCodecs.js";

interface ScreenCaptureOptions {
  captureRef: RefObject<DisplayCaptureSession | null>;
  compatibleVideoCodecs: VideoCodec[];
  getMediasoupSession: () => MediasoupSession;
  hostSettings: HostMediaSettings;
  localStatisticsRef: RefObject<StatisticsSummary>;
  localVideoCodecs: VideoCodecCapabilities;
  mediasoupRef: RefObject<MediasoupSession | null>;
  peerPresent: boolean;
  producerSettingsRef: RefObject<ProducerSettings | null>;
  publishLifecycle: (event: string, summary?: StatisticsSummary) => void;
  resetCodecFallback: () => void;
  selectedVideoCodecRef: RefObject<VideoCodec | null>;
  setCaptureActive: Dispatch<SetStateAction<boolean>>;
  setCaptureMessage: Dispatch<SetStateAction<string>>;
  setCaptureReport: Dispatch<SetStateAction<DisplayCaptureReport | null>>;
  setHostSettings: Dispatch<SetStateAction<HostMediaSettings>>;
  setLocalStatistics: Dispatch<SetStateAction<StatisticsSummary>>;
  setMediaStatus: Dispatch<SetStateAction<string>>;
  setSelectedVideoCodec: Dispatch<SetStateAction<VideoCodec | null>>;
  setSourceHdrMetadata: Dispatch<SetStateAction<HdrMetadata | null>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  status: ConnectionStatus;
  stopFrameMeasurement: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
}

export function useScreenCapture(options: ScreenCaptureOptions) {
  const {
    captureRef,
    compatibleVideoCodecs,
    getMediasoupSession,
    hostSettings,
    localStatisticsRef,
    localVideoCodecs,
    mediasoupRef,
    peerPresent,
    producerSettingsRef,
    publishLifecycle,
    resetCodecFallback,
    selectedVideoCodecRef,
    setCaptureActive,
    setCaptureMessage,
    setCaptureReport,
    setHostSettings,
    setLocalStatistics,
    setMediaStatus,
    setSelectedVideoCodec,
    setSourceHdrMetadata,
    setStatusMessage,
    status,
    stopFrameMeasurement,
    videoRef,
  } = options;

  function clearCapture(message: string): void {
    const session = captureRef.current;
    captureRef.current = null;
    producerSettingsRef.current = null;
    resetCodecFallback();
    void mediasoupRef.current?.stopProducing().catch((error: unknown) => {
      setMediaStatus(error instanceof Error ? error.message : "Could not stop producer");
    });
    stopFrameMeasurement();
    session?.stop();
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCaptureActive(false);
    setCaptureReport(null);
    setCaptureMessage(message);
    setSourceHdrMetadata(null);
    const empty = createEmptyStatisticsSummary();
    localStatisticsRef.current = empty;
    setLocalStatistics(empty);
    if (session) {
      publishLifecycle("capture.stopped", empty);
    }
  }

  async function shareScreen(): Promise<void> {
    clearCapture("Opening browser screen picker…");
    try {
      const session = await startDisplayCapture({
        // Always ask the capture stack for the configured ceiling. Chromium can
        // report a conservative 60 FPS capability even when the platform
        // capturer accepts a higher ideal, so automatic mode must not silently
        // turn the application's 120 FPS preference into a 60 FPS request.
        maxFramerate: hostSettings.maxFps,
        contentMode: hostSettings.contentMode,
        requestNativePixels: true,
        pixelRatioOverride: null,
        includeAudio: hostSettings.audioEnabled,
      });
      captureRef.current = session;
      session.track.addEventListener(
        "ended",
        () => clearCapture("Sharing ended from the browser controls."),
        { once: true },
      );
      if (videoRef.current) {
        videoRef.current.srcObject = session.stream;
      }
      await configureAndStart(session);
    } catch (error) {
      const captureError = normalizeDisplayCaptureError(error);
      setCaptureMessage(captureError.message);
      setCaptureActive(false);
    }
  }

  async function configureAndStart(session: DisplayCaptureSession): Promise<void> {
    const settings = session.report.settingsAfterConstraints;
    const hdrMetadata = await inspectTrackHdr(session.track, hostSettings.hdrEnabled);
    setSourceHdrMetadata(hdrMetadata);
    const producerMaxFps = selectProducerMaxFps({
      requestedFps: hostSettings.maxFps,
      userEdited: hostSettings.fpsUserEdited,
      reportedCapabilityMax: session.report.capabilities.frameRate.max,
      trackFrameRate: settings.frameRate,
    });
    const recommendedBitrate =
      settings.width !== null && settings.height !== null
        ? recommendH264BitrateBps({
            width: settings.width,
            height: settings.height,
            fps: producerMaxFps,
          })
        : hostSettings.maxBitrateBps;
    const producerMaxBitrate = hostSettings.bitrateUserEdited
      ? hostSettings.maxBitrateBps
      : recommendedBitrate;
    const preferredCodec =
      selectedVideoCodecRef.current ??
      (localVideoCodecs.send.includes("video/AV1") ? "video/AV1" : "video/H264");
    const codecCandidates =
      compatibleVideoCodecs.length > 0 ? compatibleVideoCodecs : localVideoCodecs.send;
    const encodingPlan = await planBalancedEncoding({
      preferred: preferredCodec,
      compatible: codecCandidates,
      width: settings.width ?? 1920,
      height: settings.height ?? 1080,
      requestedFps: producerMaxFps,
      bitrateBps: producerMaxBitrate,
      hdrMetadata,
    });
    const runtimeCodec = encodingPlan.codec;
    const producerSettings = createProducerSettings({
      width: settings.width,
      height: settings.height,
      maxFps: encodingPlan.fps,
      maxBitrateBps: producerMaxBitrate,
      contentMode: hostSettings.contentMode,
      hdrMetadata,
      preferredCodec,
      scaleResolutionDownBy: encodingPlan.scaleResolutionDownBy,
      ...(encodingPlan.fallbackCodec ? { fallbackCodec: encodingPlan.fallbackCodec } : {}),
    });
    producerSettingsRef.current = producerSettings;
    setHostSettings((current) => ({
      ...current,
      maxBitrateBps: current.bitrateUserEdited ? current.maxBitrateBps : recommendedBitrate,
    }));
    setCaptureActive(true);
    setStatusMessage(
      peerPresent ? "Starting screen share…" : "Screen ready — waiting for a viewer",
    );
    setCaptureReport(session.report);
    setCaptureMessage(
      `Track reports ${dimensions(settings.width, settings.height)} at ${formatMetric(
        settings.frameRate,
        " FPS",
      )}; ${session.audioTrack ? "system audio ready" : "no display audio selected"}; measured preview FPS appears in Debug settings.`,
    );
    const activeCapability = encodingPlan.capability;
    const initialStatistics: StatisticsSummary = {
      ...createEmptyStatisticsSummary(),
      codec: displayVideoCodec(runtimeCodec),
      sourceWidth: settings.width,
      sourceHeight: settings.height,
      captureFps: settings.frameRate,
      requiredH264Level:
        runtimeCodec === "video/H264" && settings.width !== null && settings.height !== null
          ? requiredH264Level(settings.width, settings.height, producerMaxFps)
          : null,
      encoderCapabilitySupported: activeCapability.supported,
      encoderCapabilitySmooth: activeCapability.smooth,
      encoderCapabilityPowerEfficient: activeCapability.powerEfficient,
      targetBitrateBps: producerMaxBitrate,
      controllerState: `balanced · ${encodingPlan.fps} FPS · ${encodingPlan.scaleResolutionDownBy}× scale`,
    };
    localStatisticsRef.current = initialStatistics;
    setLocalStatistics(initialStatistics);
    publishLifecycle("capture.started", initialStatistics);
    if (status === "joined" && selectedVideoCodecRef.current) {
      const activeCodec = codecCandidates.includes(runtimeCodec)
        ? runtimeCodec
        : selectedVideoCodecRef.current;
      setSelectedVideoCodec(activeCodec);
      try {
        await getMediasoupSession().startProducing(
          session.track,
          producerSettings,
          activeCodec,
          session.audioTrack,
        );
        setStatusMessage("Sharing screen");
      } catch (error) {
        setMediaStatus(error instanceof Error ? error.message : "Could not start video producer");
      }
    } else if (status === "joined") {
      setMediaStatus("Waiting for a viewer with a compatible AV1 or H.264 receive codec");
    } else {
      setMediaStatus("Join a room to send the captured screen");
    }
  }

  return { clearCapture, shareScreen };
}
