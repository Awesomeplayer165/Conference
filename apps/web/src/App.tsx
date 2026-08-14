import {
  createEmptyStatisticsSummary,
  type HdrMetadata,
  type MediaRequestMessage,
  type MediaResponseMessage,
  PROTOCOL_VERSION,
  type Role,
  type StatisticsSummary,
  type VideoCodec,
} from "@conference/protocol";
import { ClockOffsetEstimator } from "@conference/telemetry";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DisplayCaptureReport, DisplayCaptureSession } from "./capture/index.js";
import { type ConnectionStatus, ScreenShareView } from "./components/ScreenShareView.js";
import { useFrameMetrics } from "./hooks/useFrameMetrics.js";
import { useMediaAdaptation } from "./hooks/useMediaAdaptation.js";
import { useScreenCapture } from "./hooks/useScreenCapture.js";
import { useSessionControls } from "./hooks/useSessionControls.js";
import { useTelemetry } from "./hooks/useTelemetry.js";
import { describeHdrPath, detectHdrDisplaySupport, inspectTrackHdr } from "./media/hdr.js";
import { loadHostMediaSettings, saveHostMediaSettings } from "./media/hostSettings.js";
import { MediasoupSession, type ProducerSettings } from "./media/MediasoupSession.js";
import { createProducerSettings } from "./media/producerPolicy.js";
import { detectVideoCodecCapabilities } from "./media/videoCodecs.js";
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
  const [compatibleVideoCodecs, setCompatibleVideoCodecs] = useState<VideoCodec[]>([]);
  const [localStatistics, setLocalStatistics] = useState(createEmptyStatisticsSummary);
  const [peerStatistics, setPeerStatistics] = useState(createEmptyStatisticsSummary);
  const [hostSettings, setHostSettings] = useState(loadHostMediaSettings);
  const [captureActive, setCaptureActive] = useState(false);
  const [mediaStatus, setMediaStatus] = useState("Media idle");
  const [remoteTrack, setRemoteTrack] = useState<MediaStreamTrack | null>(null);
  const [sourceHdrMetadata, setSourceHdrMetadata] = useState<HdrMetadata | null>(null);
  const [decodedHdrMetadata, setDecodedHdrMetadata] = useState<HdrMetadata | null>(null);
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
  const hdrInspectionTrackRef = useRef<MediaStreamTrack | null>(null);
  const mediasoupRef = useRef<MediasoupSession | null>(null);
  const producerSettingsRef = useRef<ProducerSettings | null>(null);
  const selectedVideoCodecRef = useRef<VideoCodec | null>(null);
  const pendingMediaRef = useRef(new Map<string, PendingMediaRequest>());
  const clockEstimatorRef = useRef(new ClockOffsetEstimator());
  const localStatisticsRef = useRef(localStatistics);
  const sampleObserverRef = useRef<((summary: StatisticsSummary) => void) | null>(null);
  const endpointId = useMemo(() => crypto.randomUUID(), []);
  const localVideoCodecs = useMemo(detectVideoCodecCapabilities, []);
  const hdrDisplaySupport = useMemo(detectHdrDisplaySupport, []);
  const hdrStatus = describeHdrPath({
    source: sourceHdrMetadata,
    decoded: role === "host" ? sourceHdrMetadata : decodedHdrMetadata,
    display: hdrDisplaySupport,
    codec: selectedVideoCodec,
  });

  localStatisticsRef.current = localStatistics;
  selectedVideoCodecRef.current = selectedVideoCodec;
  const { observeMediaSample, resetMediaAdaptation } = useMediaAdaptation({
    captureRef,
    compatibleVideoCodecs,
    hostSettings,
    localStatisticsRef,
    mediasoupRef,
    producerSettingsRef,
    remoteVideoRef,
    role,
    selectedVideoCodec,
    selectedVideoCodecRef,
    setLocalStatistics,
    setMediaStatus,
    setSelectedVideoCodec,
  });
  sampleObserverRef.current = observeMediaSample;

  const {
    artifactCount: telemetryArtifactCount,
    download: downloadTelemetry,
    publish: publishTelemetry,
    publishLifecycle: publishLifecycleEvent,
    recordPeerEnvelope,
  } = useTelemetry({
    endpointId,
    localStatisticsRef,
    mediasoupRef,
    onSampleRef: sampleObserverRef,
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
      const currentProducerSettings = producerSettingsRef.current;
      const settings = captureRef.current?.report.settingsAfterConstraints;
      producerSettingsRef.current = createProducerSettings({
        width: settings?.width ?? null,
        height: settings?.height ?? null,
        maxFps: currentProducerSettings.maxFps,
        maxBitrateBps: hostSettings.maxBitrateBps,
        contentMode: "auto",
        ...(currentProducerSettings.scaleResolutionDownBy
          ? { scaleResolutionDownBy: currentProducerSettings.scaleResolutionDownBy }
          : {}),
        ...(currentProducerSettings.hdrMetadata
          ? { hdrMetadata: currentProducerSettings.hdrMetadata }
          : {}),
        ...(currentProducerSettings.preferredCodec
          ? { preferredCodec: currentProducerSettings.preferredCodec }
          : {}),
        ...(currentProducerSettings.fallbackCodec
          ? { fallbackCodec: currentProducerSettings.fallbackCodec }
          : {}),
      });
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
        ...(producerSettingsRef.current ??
          createProducerSettings({
            width: null,
            height: null,
            maxFps: hostSettings.maxFps,
            maxBitrateBps: hostSettings.maxBitrateBps,
            contentMode: "auto",
          })),
      })
      .catch((error: unknown) => {
        setMediaStatus(error instanceof Error ? error.message : "Could not update encoder");
      });
  }, [hostSettings]);

  useEffect(() => {
    localStorage.setItem(DEBUG_OVERLAY_STORAGE_KEY, String(debugOverlayEnabled));
  }, [debugOverlayEnabled]);

  useEffect(() => {
    setLocalStatistics((current) => {
      const next = {
        ...current,
        hdrMode: sourceHdrMetadata?.mode ?? null,
        hdrStatus,
        displayHdrSupported: hdrDisplaySupport.highDynamicRange,
      };
      localStatisticsRef.current = next;
      return next;
    });
  }, [hdrDisplaySupport.highDynamicRange, hdrStatus, sourceHdrMetadata?.mode]);

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
        onRemoteTrack: (track) => {
          hdrInspectionTrackRef.current = track;
          setRemoteTrack(track);
          setDecodedHdrMetadata(null);
          if (track) {
            void inspectTrackHdr(track, true).then((metadata) => {
              if (hdrInspectionTrackRef.current === track) {
                setDecodedHdrMetadata(metadata);
              }
            });
          }
        },
        onRemoteHdrMetadata: setSourceHdrMetadata,
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
  const { clearCapture, shareScreen } = useScreenCapture({
    captureRef,
    compatibleVideoCodecs,
    getMediasoupSession,
    hostSettings,
    localStatisticsRef,
    localVideoCodecs,
    mediasoupRef,
    peerPresent,
    producerSettingsRef,
    publishLifecycle: publishLifecycleEvent,
    resetCodecFallback: resetMediaAdaptation,
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
      recordPeerEnvelope,
      role,
      roomId,
      setLocalStatistics,
      setMediaStatus,
      setPeerPresent,
      setPeerStatistics,
      setSelectedVideoCodec,
      setCompatibleVideoCodecs,
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
    setSourceHdrMetadata(null);
    setDecodedHdrMetadata(null);
    setMediaStatus("Media idle");
    setStatus("idle");
    setStatusMessage("Not connected");
    setPeerPresent(false);
    setSelectedVideoCodec(null);
    setCompatibleVideoCodecs([]);
    setPeerStatistics(createEmptyStatisticsSummary());
    if (role === "host") {
      setRoomId(generateSessionCode());
      setCodeCopied(false);
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
      hdrOutputEnabled={
        hdrDisplaySupport.highDynamicRange &&
        (role === "host"
          ? sourceHdrMetadata?.mode === "hdr-pq" || sourceHdrMetadata?.mode === "hdr-hlg"
          : decodedHdrMetadata?.mode === "hdr-pq" || decodedHdrMetadata?.mode === "hdr-hlg")
      }
      hdrStatus={hdrStatus}
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
