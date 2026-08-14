import type { StatisticsSummary, VideoCodec } from "@conference/protocol";
import { FramePresentationMonitor } from "@conference/telemetry";
import { useCallback, useEffect, useRef } from "react";
import type { DisplayCaptureSession } from "../capture/index.js";
import { displayVideoCodec } from "../media/videoCodecs.js";

interface UseFrameMetricsOptions {
  captureActive: boolean;
  captureRef: React.RefObject<DisplayCaptureSession | null>;
  localStatisticsRef: React.RefObject<StatisticsSummary>;
  remoteTrack: MediaStreamTrack | null;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  role: "host" | "viewer";
  selectedVideoCodecRef: React.RefObject<VideoCodec | null>;
  setLocalStatistics: React.Dispatch<React.SetStateAction<StatisticsSummary>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function useFrameMetrics(options: UseFrameMetricsOptions) {
  const {
    captureActive,
    captureRef,
    localStatisticsRef,
    remoteTrack,
    remoteVideoRef,
    role,
    selectedVideoCodecRef,
    setLocalStatistics,
    setStatusMessage,
    videoRef,
  } = options;
  const frameCallbackRef = useRef<number | null>(null);
  const frameVideoRef = useRef<HTMLVideoElement | null>(null);
  const presentationMonitorRef = useRef(new FramePresentationMonitor());

  const stopFrameMeasurement = useCallback((): void => {
    const video = frameVideoRef.current;
    if (
      video &&
      frameCallbackRef.current !== null &&
      typeof video.cancelVideoFrameCallback === "function"
    ) {
      video.cancelVideoFrameCallback(frameCallbackRef.current);
    }
    frameCallbackRef.current = null;
    frameVideoRef.current = null;
    presentationMonitorRef.current.reset();
  }, []);

  const startFrameMeasurement = useCallback(
    (video: HTMLVideoElement, sourcePreview: boolean): void => {
      stopFrameMeasurement();
      if (typeof video.requestVideoFrameCallback !== "function") {
        return;
      }
      frameVideoRef.current = video;

      const measure: VideoFrameRequestCallback = (now, metadata) => {
        if (!video.srcObject) {
          return;
        }
        const sample = presentationMonitorRef.current.observe(now, metadata);
        if (sample) {
          setLocalStatistics((current) => {
            const next = {
              ...current,
              previewFps: sourcePreview ? sample.presentationFps : current.previewFps,
              presentationFps: sample.presentationFps,
              frameCadenceDeviationMs: sample.frameCadenceDeviationMs,
              freezeCount: Math.max(current.freezeCount ?? 0, sample.freezeCount),
              freezeDurationMs: Math.max(current.freezeDurationMs ?? 0, sample.freezeDurationMs),
              estimatedLatencyMs: sourcePreview
                ? current.estimatedLatencyMs
                : (sample.estimatedLatencyMs ?? current.estimatedLatencyMs),
              latencyP50Ms: sourcePreview
                ? current.latencyP50Ms
                : (sample.latencyP50Ms ?? current.latencyP50Ms),
              latencyP95Ms: sourcePreview
                ? current.latencyP95Ms
                : (sample.latencyP95Ms ?? current.latencyP95Ms),
              latencyP99Ms: sourcePreview
                ? current.latencyP99Ms
                : (sample.latencyP99Ms ?? current.latencyP99Ms),
            };
            localStatisticsRef.current = next;
            return next;
          });
        }
        frameCallbackRef.current = video.requestVideoFrameCallback(measure);
      };
      frameCallbackRef.current = video.requestVideoFrameCallback(measure);
    },
    [localStatisticsRef, setLocalStatistics, stopFrameMeasurement],
  );

  const updateRenderGeometry = useCallback((): void => {
    const video = videoRef.current;
    if (!video || !captureRef.current) {
      return;
    }
    setLocalStatistics((current) => ({
      ...current,
      renderWidth: video.clientWidth || null,
      renderHeight: video.clientHeight || null,
    }));
    startFrameMeasurement(video, true);
  }, [captureRef, setLocalStatistics, startFrameMeasurement, videoRef]);

  const updateRemoteGeometry = useCallback((): void => {
    const video = remoteVideoRef.current;
    if (!video) {
      return;
    }
    setLocalStatistics((current) => ({
      ...current,
      codec: selectedVideoCodecRef.current
        ? displayVideoCodec(selectedVideoCodecRef.current)
        : current.codec,
      decodedWidth: video.videoWidth || null,
      decodedHeight: video.videoHeight || null,
      renderWidth: video.clientWidth || null,
      renderHeight: video.clientHeight || null,
    }));
    setStatusMessage("Viewing shared screen");
    startFrameMeasurement(video, false);
  }, [
    remoteVideoRef,
    selectedVideoCodecRef,
    setLocalStatistics,
    setStatusMessage,
    startFrameMeasurement,
  ]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (video) {
      video.srcObject = remoteTrack ? new MediaStream([remoteTrack]) : null;
    }
  }, [remoteTrack, remoteVideoRef]);

  useEffect(() => {
    const video = role === "host" ? videoRef.current : remoteVideoRef.current;
    const videoActive = role === "host" ? captureActive : remoteTrack !== null;
    if (!videoActive || !video || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      setLocalStatistics((current) => ({
        ...current,
        renderWidth: Math.round(entry.contentRect.width) || null,
        renderHeight: Math.round(entry.contentRect.height) || null,
      }));
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [captureActive, remoteTrack, remoteVideoRef, role, setLocalStatistics, videoRef]);

  useEffect(() => stopFrameMeasurement, [stopFrameMeasurement]);

  return { stopFrameMeasurement, updateRemoteGeometry, updateRenderGeometry };
}
