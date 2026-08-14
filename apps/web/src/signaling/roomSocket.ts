import {
  createEmptyStatisticsSummary,
  type MediaResponseMessage,
  PROTOCOL_VERSION,
  type Role,
  type StatisticsSummary,
  safeParseServerMessage,
  type TelemetryEnvelope,
  type VideoCodec,
  type VideoCodecCapabilities,
} from "@conference/protocol";
import type { ClockOffsetEstimator } from "@conference/telemetry";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { DisplayCaptureSession } from "../capture/index.js";
import type { ConnectionStatus } from "../components/ScreenShareView.js";
import type { MediasoupSession, ProducerSettings } from "../media/MediasoupSession.js";

export interface PendingMediaRequest {
  resolve: (response: MediaResponseMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface OpenRoomConnectionOptions {
  captureRef: RefObject<DisplayCaptureSession | null>;
  clockEstimator: ClockOffsetEstimator;
  endpointId: string;
  getMediasoupSession: () => MediasoupSession;
  localVideoCodecs: VideoCodecCapabilities;
  mediasoupRef: RefObject<MediasoupSession | null>;
  pendingMediaRef: RefObject<Map<string, PendingMediaRequest>>;
  producerSettingsRef: RefObject<ProducerSettings | null>;
  publishLifecycle: (event: string) => void;
  recordPeerEnvelope: (envelope: TelemetryEnvelope) => void;
  role: Role;
  roomId: string;
  setLocalStatistics: Dispatch<SetStateAction<StatisticsSummary>>;
  setMediaStatus: Dispatch<SetStateAction<string>>;
  setPeerPresent: Dispatch<SetStateAction<boolean>>;
  setPeerStatistics: Dispatch<SetStateAction<StatisticsSummary>>;
  setSelectedVideoCodec: Dispatch<SetStateAction<VideoCodec | null>>;
  setCompatibleVideoCodecs: Dispatch<SetStateAction<VideoCodec[]>>;
  setStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  socketRef: RefObject<WebSocket | null>;
}

export function signalingUrl(): string {
  const configured = import.meta.env.VITE_SIGNALING_URL;
  if (configured) {
    return configured;
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws`;
}

export function sendClient(socket: WebSocket, message: object): void {
  socket.send(JSON.stringify(message));
}

export function openRoomConnection(options: OpenRoomConnectionOptions): WebSocket {
  const {
    captureRef,
    clockEstimator,
    endpointId,
    getMediasoupSession,
    localVideoCodecs,
    mediasoupRef,
    pendingMediaRef,
    producerSettingsRef,
    publishLifecycle,
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
  } = options;
  const socket = new WebSocket(signalingUrl());
  socketRef.current = socket;

  socket.addEventListener("open", () => {
    sendClient(socket, {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      role,
      endpointId,
      browser: {
        name: navigator.userAgent,
        version: navigator.appVersion,
        os: navigator.platform,
      },
      videoCodecs: localVideoCodecs,
    });
  });

  socket.addEventListener("message", (event) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(event.data));
    } catch {
      setStatus("error");
      setStatusMessage("Signaling returned invalid JSON");
      return;
    }
    const result = safeParseServerMessage(raw);
    if (!result.success) {
      setStatus("error");
      setStatusMessage("Signaling returned an invalid message");
      return;
    }
    if ("requestId" in result.data && typeof result.data.requestId === "string") {
      const pending = pendingMediaRef.current.get(result.data.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingMediaRef.current.delete(result.data.requestId);
        pending.resolve(result.data as MediaResponseMessage);
      }
      return;
    }
    switch (result.data.type) {
      case "room.joined":
        setStatus("joined");
        setStatusMessage(
          result.data.role === "host"
            ? result.data.peerPresent
              ? "Viewer connected"
              : "Session ready — waiting for a viewer"
            : result.data.peerPresent
              ? "Connected — waiting for the shared screen"
              : "Session opened — waiting for the host",
        );
        setPeerPresent(result.data.peerPresent);
        setSelectedVideoCodec(result.data.selectedVideoCodec ?? null);
        setCompatibleVideoCodecs(result.data.compatibleVideoCodecs ?? []);
        publishLifecycle("room.joined");
        break;
      case "room.peerUpdate": {
        setPeerPresent(result.data.present);
        setStatusMessage(
          result.data.present
            ? role === "host"
              ? "Viewer connected"
              : "Host connected — waiting for the shared screen"
            : role === "host"
              ? "Waiting for a viewer"
              : "The host disconnected",
        );
        setSelectedVideoCodec(result.data.selectedVideoCodec ?? null);
        setCompatibleVideoCodecs(result.data.compatibleVideoCodecs ?? []);
        publishLifecycle(result.data.present ? "peer.joined" : "peer.left");
        if (role === "host") {
          const codec = result.data.selectedVideoCodec ?? null;
          const capture = captureRef.current;
          const settings = producerSettingsRef.current;
          if (result.data.present && codec && capture && settings) {
            const runtimeCodec =
              settings.preferredCodec &&
              (result.data.compatibleVideoCodecs ?? []).includes(settings.preferredCodec)
                ? settings.preferredCodec
                : codec;
            setSelectedVideoCodec(runtimeCodec);
            void getMediasoupSession()
              .startProducing(capture.track, settings, runtimeCodec)
              .then(() => setStatusMessage("Sharing screen"))
              .catch((error: unknown) => {
                setMediaStatus(
                  error instanceof Error ? error.message : "Could not start video producer",
                );
              });
          } else if (!result.data.present) {
            void mediasoupRef.current?.stopProducing();
          } else if (result.data.present && !codec) {
            setMediaStatus("No end-to-end AV1 or H.264 codec is available for this browser pair");
          }
        }
        if (!result.data.present) {
          setPeerStatistics(createEmptyStatisticsSummary());
          setCompatibleVideoCodecs([]);
        }
        break;
      }
      case "telemetry.peerSummary":
        setPeerStatistics(result.data.summary);
        if (result.data.envelope) {
          recordPeerEnvelope(result.data.envelope);
        }
        break;
      case "telemetry.clockProbeResult": {
        const estimate = clockEstimator.observe({
          clientSendTimeMs: result.data.clientSendTimeMs,
          serverReceiveTimeMs: result.data.serverReceiveTimeMs,
          serverSendTimeMs: result.data.serverSendTimeMs,
          clientReceiveTimeMs: performance.timeOrigin + performance.now(),
        });
        if (estimate) {
          setLocalStatistics((current) => ({
            ...current,
            clockOffsetMs: Number(estimate.offsetMs.toFixed(2)),
            clockProbeRttMs: Number(estimate.roundTripTimeMs.toFixed(2)),
          }));
        }
        break;
      }
      case "room.error":
        setStatus("error");
        setStatusMessage(result.data.message);
        break;
      case "media.placeholder":
        setStatusMessage(result.data.note);
        break;
      case "media.producerAvailable":
        if (role === "viewer") {
          if (result.data.codec) {
            setSelectedVideoCodec(result.data.codec);
          }
          setStatusMessage("Connecting to the shared screen…");
          setMediaStatus("Negotiating the receive transport…");
          void getMediasoupSession()
            .consume(result.data.producerId, result.data.hdrMetadata)
            .then(() => {
              setStatusMessage("Receiving shared screen…");
              publishLifecycle("media.consumer.ready");
            })
            .catch((error: unknown) => {
              const message =
                error instanceof Error ? error.message : "Could not receive screen video";
              setMediaStatus(`Media connection failed: ${message}`);
              setStatusMessage("Connected — the shared screen could not start");
              publishLifecycle("media.consumer.failed");
            });
        }
        break;
      case "media.producerClosed":
        if (mediasoupRef.current?.consumingProducerId === result.data.producerId) {
          mediasoupRef.current.stopConsuming(result.data.producerId);
          setMediaStatus("The host stopped sharing");
          setStatusMessage("Connected — waiting for the shared screen");
        }
        break;
      case "media.error":
        setMediaStatus(result.data.message);
        break;
      case "media.routerCapabilities":
      case "media.transportCreated":
      case "media.produced":
      case "media.consumerCreated":
      case "media.ack":
      case "media.serverStats":
        break;
    }
  });

  socket.addEventListener("error", () => {
    setStatus("error");
    setStatusMessage(`Could not connect to ${signalingUrl()}`);
  });

  socket.addEventListener("close", () => {
    if (socketRef.current === socket) {
      publishLifecycle("room.disconnected");
      socketRef.current = null;
      mediasoupRef.current?.close();
      mediasoupRef.current = null;
      setStatus((current) => (current === "error" ? current : "idle"));
      setStatusMessage((current) => (current.includes("Could not") ? current : "Disconnected"));
    }
  });
  return socket;
}
