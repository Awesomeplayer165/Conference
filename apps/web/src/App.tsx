import {
  createEmptyStatisticsSummary,
  type MediaRequestMessage,
  type MediaResponseMessage,
  PROTOCOL_VERSION,
  type Role,
  type StatisticsSummary,
  type VideoCodec,
} from "@conference/protocol";
import { ClockOffsetEstimator } from "@conference/telemetry";
import { formatMetric } from "@conference/telemetry/metrics";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type DisplayCaptureReport,
  type DisplayCaptureSession,
  normalizeDisplayCaptureError,
  startDisplayCapture,
} from "./capture/index.js";
import { dimensions } from "./components/Diagnostics.js";
import { type ConnectionStatus, ScreenShareView } from "./components/ScreenShareView.js";
import { useFrameMetrics } from "./hooks/useFrameMetrics.js";
import { useSessionControls } from "./hooks/useSessionControls.js";
import { useTelemetry } from "./hooks/useTelemetry.js";
import { recommendH264BitrateBps } from "./media/h264Bitrate.js";
import { probeH264EncodingCapability, requiredH264Level } from "./media/h264Capability.js";
import { loadHostMediaSettings, saveHostMediaSettings } from "./media/hostSettings.js";
import { MediasoupSession } from "./media/MediasoupSession.js";
import { detectVideoCodecCapabilities, displayVideoCodec } from "./media/videoCodecs.js";
import { generateSessionCode, isCompleteSessionCode } from "./sessionCode.js";
import {
  openRoomConnection,
  type PendingMediaRequest,
  sendClient,
} from "./signaling/roomSocket.js";

const DEBUG_OVERLAY_STORAGE_KEY = "conference.debug-overlay.v1";

export function App() {
  const [role, setRole] = useState<Role>("host");
  const [roomId, setRoomId] = useState(generateSessionCode);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Not connected");
  const [peerPresent, setPeerPresent] = useState(false);
  const [selectedVideoCodec, setSelectedVideoCodec] = useState<VideoCodec | null>(null);
  const [localStatistics, setLocalStatistics] = useState(createEmptyStatisticsSummary);
  const [peerStatistics, setPeerStatistics] = useState(createEmptyStatisticsSummary);
  const [hostSettings, setHostSettings] = useState(loadHostMediaSettings);
  const [captureActive, setCaptureActive] = useState(false);
  const [mediaStatus, setMediaStatus] = useState("Media idle");
  const [remoteTrack, setRemoteTrack] = useState<MediaStreamTrack | null>(null);
  const [captureMessage, setCaptureMessage] = useState(
    "Select a screen, window, or tab to inspect its actual capture geometry.",
  );
  const [captureReport, setCaptureReport] = useState<DisplayCaptureReport | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [debugOverlayEnabled, setDebugOverlayEnabled] = useState(
    () => localStorage.getItem(DEBUG_OVERLAY_STORAGE_KEY) === "true",
  );
  const socketRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<DisplayCaptureSession | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediasoupRef = useRef<MediasoupSession | null>(null);
  const producerSettingsRef = useRef<{ maxFps: number; maxBitrateBps: number } | null>(null);
  const selectedVideoCodecRef = useRef<VideoCodec | null>(null);
  const pendingMediaRef = useRef(new Map<string, PendingMediaRequest>());
  const clockEstimatorRef = useRef(new ClockOffsetEstimator());
  const localStatisticsRef = useRef(localStatistics);
  const endpointId = useMemo(() => crypto.randomUUID(), []);
  const localVideoCodecs = useMemo(detectVideoCodecCapabilities, []);

  localStatisticsRef.current = localStatistics;
  selectedVideoCodecRef.current = selectedVideoCodec;

  const {
    artifactCount: telemetryArtifactCount,
    download: downloadTelemetry,
    publish: publishTelemetry,
    publishLifecycle: publishLifecycleEvent,
  } = useTelemetry({
    endpointId,
    localStatisticsRef,
    mediasoupRef,
    role,
    roomId,
    setLocalStatistics,
    socketRef,
    status,
  });
  const { stopFrameMeasurement, updateRemoteGeometry, updateRenderGeometry } = useFrameMetrics({
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
  });

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      captureRef.current?.stop();
      mediasoupRef.current?.close();
      for (const pending of pendingMediaRef.current.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Application closed"));
      }
      pendingMediaRef.current.clear();
    };
  }, []);

  useEffect(() => {
    saveHostMediaSettings(hostSettings);
    if (producerSettingsRef.current) {
      producerSettingsRef.current = {
        maxFps: hostSettings.maxFps,
        maxBitrateBps: hostSettings.maxBitrateBps,
      };
    }
    setLocalStatistics((current) => {
      if (current.targetBitrateBps === null) {
        return current;
      }
      const next = { ...current, targetBitrateBps: hostSettings.maxBitrateBps };
      localStatisticsRef.current = next;
      return next;
    });
    void mediasoupRef.current
      ?.updateProducerSettings({
        maxFps: hostSettings.maxFps,
        maxBitrateBps: hostSettings.maxBitrateBps,
      })
      .catch((error: unknown) => {
        setMediaStatus(error instanceof Error ? error.message : "Could not update encoder");
      });
  }, [hostSettings]);

  useEffect(() => {
    localStorage.setItem(DEBUG_OVERLAY_STORAGE_KEY, String(debugOverlayEnabled));
  }, [debugOverlayEnabled]);

  function requestMedia(message: MediaRequestMessage): Promise<MediaResponseMessage> {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Signaling is not connected"));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingMediaRef.current.delete(message.requestId);
        reject(new Error(`Media request timed out: ${message.type}`));
      }, 10_000);
      pendingMediaRef.current.set(message.requestId, {
        resolve,
        reject,
        timeout,
      });
      sendClient(socket, message);
    });
  }

  function getMediasoupSession(): MediasoupSession {
    let session = mediasoupRef.current;
    if (!session) {
      session = new MediasoupSession(requestMedia, {
        onState: setMediaStatus,
        onRemoteTrack: setRemoteTrack,
        onTransportState: (direction, transportState) => {
          setLocalStatistics((current) => {
            const next = {
              ...current,
              transportState,
              mediaFlowState: transportState === "failed" ? "failed" : current.mediaFlowState,
            };
            localStatisticsRef.current = next;
            return next;
          });
          publishTelemetry("event", localStatisticsRef.current, {
            event: "webrtc.transportState",
            direction,
            transportState,
          });
        },
      });
      mediasoupRef.current = session;
    }
    return session;
  }

  const { chooseRole, copySessionCode, regenerateSessionCode, setAutomaticBitrate } =
    useSessionControls({
      captureRef,
      producerSettingsRef,
      roomId,
      setCodeCopied,
      setHostSettings,
      setRole,
      setRoomId,
      setStatusMessage,
    });

  function joinRoom(): void {
    if (!isCompleteSessionCode(roomId)) {
      setStatus("error");
      setStatusMessage("Enter a complete six-character session code");
      return;
    }
    socketRef.current?.close();
    setStatus("connecting");
    setStatusMessage(role === "host" ? "Creating session…" : "Connecting to session…");
    setPeerPresent(false);
    setSelectedVideoCodec(null);
    setPeerStatistics(createEmptyStatisticsSummary());
    openRoomConnection({
      captureRef,
      clockEstimator: clockEstimatorRef.current,
      endpointId,
      getMediasoupSession,
      localVideoCodecs,
      mediasoupRef,
      pendingMediaRef,
      producerSettingsRef,
      publishLifecycle: publishLifecycleEvent,
      role,
      roomId,
      setLocalStatistics,
      setMediaStatus,
      setPeerPresent,
      setPeerStatistics,
      setSelectedVideoCodec,
      setStatus,
      setStatusMessage,
      socketRef,
    });
  }

  function leaveRoom() {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      publishLifecycleEvent("room.left");
      sendClient(socket, {
        type: "room.leave",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        endpointId,
      });
    }
    socket?.close();
    socketRef.current = null;
    mediasoupRef.current?.close();
    mediasoupRef.current = null;
    setRemoteTrack(null);
    setMediaStatus("Media idle");
    setStatus("idle");
    setStatusMessage("Not connected");
    setPeerPresent(false);
    setSelectedVideoCodec(null);
    setPeerStatistics(createEmptyStatisticsSummary());
    if (role === "host") {
      setRoomId(generateSessionCode());
      setCodeCopied(false);
    }
  }

  function clearCapture(message: string): void {
    const session = captureRef.current;
    captureRef.current = null;
    producerSettingsRef.current = null;
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
    const empty = createEmptyStatisticsSummary();
    localStatisticsRef.current = empty;
    setLocalStatistics(empty);
    if (session) {
      publishLifecycleEvent("capture.stopped", empty);
    }
  }

  async function shareScreen(): Promise<void> {
    clearCapture("Opening browser screen picker…");
    try {
      const session = await startDisplayCapture({
        maxFramerate: null,
        contentMode: hostSettings.contentMode,
        requestNativePixels: true,
        pixelRatioOverride: null,
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

      const settings = session.report.settingsAfterConstraints;
      const selectedMaxFps =
        session.report.capabilities.frameRate.max ?? settings.frameRate ?? hostSettings.maxFps;
      const producerMaxFps = hostSettings.fpsUserEdited
        ? Math.min(hostSettings.maxFps, selectedMaxFps)
        : selectedMaxFps;
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
      producerSettingsRef.current = {
        maxFps: producerMaxFps,
        maxBitrateBps: producerMaxBitrate,
      };
      setHostSettings((current) => ({
        ...current,
        maxFps: current.fpsUserEdited ? current.maxFps : selectedMaxFps,
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
        )}; measured preview FPS appears in Debug settings.`,
      );
      const initialStatistics: StatisticsSummary = {
        ...createEmptyStatisticsSummary(),
        codec: selectedVideoCodecRef.current
          ? displayVideoCodec(selectedVideoCodecRef.current)
          : null,
        sourceWidth: settings.width,
        sourceHeight: settings.height,
        captureFps: settings.frameRate,
        requiredH264Level:
          selectedVideoCodecRef.current === "video/H264" &&
          settings.width !== null &&
          settings.height !== null
            ? requiredH264Level(settings.width, settings.height, producerMaxFps)
            : null,
        targetBitrateBps: producerMaxBitrate,
        controllerState: "measurement-only",
      };
      localStatisticsRef.current = initialStatistics;
      setLocalStatistics(initialStatistics);
      publishLifecycleEvent("capture.started", initialStatistics);
      if (
        selectedVideoCodecRef.current === "video/H264" &&
        settings.width !== null &&
        settings.height !== null
      ) {
        void probeH264EncodingCapability({
          width: settings.width,
          height: settings.height,
          fps: producerMaxFps,
          bitrateBps: producerMaxBitrate,
        }).then((result) => {
          setLocalStatistics((current) => {
            const next = {
              ...current,
              requiredH264Level: result.requiredLevel,
              encoderCapabilitySupported: result.supported,
              encoderCapabilitySmooth: result.smooth,
              encoderCapabilityPowerEfficient: result.powerEfficient,
            };
            localStatisticsRef.current = next;
            return next;
          });
        });
      }
      if (status === "joined" && selectedVideoCodecRef.current) {
        try {
          await getMediasoupSession().startProducing(
            session.track,
            {
              maxFps: producerMaxFps,
              maxBitrateBps: producerMaxBitrate,
            },
            selectedVideoCodecRef.current,
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
    } catch (error) {
      const captureError = normalizeDisplayCaptureError(error);
      setCaptureMessage(captureError.message);
      setCaptureActive(false);
    }
  }

  const joined = status === "joined";
  const videoActive = role === "host" ? captureActive : remoteTrack !== null;
  const sessionCodeReady = isCompleteSessionCode(roomId);
  return (
    <ScreenShareView
      captureActive={captureActive}
      captureMessage={captureMessage}
      captureReport={captureReport}
      chooseRole={chooseRole}
      clearCapture={clearCapture}
      codeCopied={codeCopied}
      copySessionCode={copySessionCode}
      debugOverlayEnabled={debugOverlayEnabled}
      downloadTelemetry={downloadTelemetry}
      hostSettings={hostSettings}
      joinRoom={joinRoom}
      joined={joined}
      leaveRoom={leaveRoom}
      localStatistics={localStatistics}
      localVideoCodecs={localVideoCodecs}
      mediaStatus={mediaStatus}
      peerPresent={peerPresent}
      peerStatistics={peerStatistics}
      regenerateSessionCode={regenerateSessionCode}
      remoteActive={remoteTrack !== null}
      remoteVideoRef={remoteVideoRef}
      role={role}
      roomId={roomId}
      selectedVideoCodec={selectedVideoCodec}
      sessionCodeReady={sessionCodeReady}
      setAutomaticBitrate={setAutomaticBitrate}
      setDebugOverlayEnabled={setDebugOverlayEnabled}
      setHostSettings={setHostSettings}
      setRoomId={setRoomId}
      shareScreen={shareScreen}
      status={status}
      statusMessage={statusMessage}
      telemetryArtifactCount={telemetryArtifactCount}
      updateRemoteGeometry={updateRemoteGeometry}
      updateRenderGeometry={updateRenderGeometry}
      videoActive={videoActive}
      videoRef={videoRef}
    />
  );
}
