import {
  PROTOCOL_VERSION,
  type Role,
  type StatisticsSummary,
  type TelemetryEnvelope,
} from "@conference/protocol";
import { createTelemetryEnvelope, WebRtcStatsNormalizer } from "@conference/telemetry";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionStatus } from "../components/ScreenShareView.js";
import type { MediasoupSession } from "../media/MediasoupSession.js";

type TelemetryPrimitive = string | number | boolean | null;

interface UseTelemetryOptions {
  endpointId: string;
  localStatisticsRef: React.RefObject<StatisticsSummary>;
  mediasoupRef: React.RefObject<MediasoupSession | null>;
  onSampleRef?: React.RefObject<((summary: StatisticsSummary) => void) | null>;
  role: Role;
  roomId: string;
  setLocalStatistics: React.Dispatch<React.SetStateAction<StatisticsSummary>>;
  socketRef: React.RefObject<WebSocket | null>;
  status: ConnectionStatus;
}

function telemetryPayload(summary: StatisticsSummary): Record<string, TelemetryPrimitive> {
  return Object.fromEntries(Object.entries(summary)) as Record<string, TelemetryPrimitive>;
}

function telemetryPresence(summary: StatisticsSummary): Record<string, boolean> {
  return Object.fromEntries(Object.entries(summary).map(([name, value]) => [name, value !== null]));
}

function sendTelemetry(
  socket: WebSocket,
  roomId: string,
  summary: StatisticsSummary,
  envelope: ReturnType<typeof createTelemetryEnvelope>,
): void {
  socket.send(
    JSON.stringify({
      type: "telemetry.publish",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      summary,
      envelope,
    }),
  );
}

export function useTelemetry(options: UseTelemetryOptions) {
  const {
    endpointId,
    localStatisticsRef,
    mediasoupRef,
    onSampleRef,
    role,
    roomId,
    setLocalStatistics,
    socketRef,
    status,
  } = options;
  const [artifactCount, setArtifactCount] = useState(0);
  const artifactsRef = useRef<string[]>([]);
  const normalizerRef = useRef(new WebRtcStatsNormalizer());
  const sampleObserver = onSampleRef;
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const sequenceRef = useRef(0);

  const publish = useCallback(
    (
      kind: "sample" | "event",
      summary: StatisticsSummary,
      eventPayload?: Record<string, TelemetryPrimitive>,
    ): void => {
      const payload = kind === "sample" ? telemetryPayload(summary) : (eventPayload ?? {});
      const envelope = createTelemetryEnvelope({
        sessionId,
        endpointId,
        role,
        monotonicTime: performance.now(),
        sequence: sequenceRef.current++,
        kind,
        browser: {
          name: navigator.userAgent,
          version: navigator.appVersion,
          os: navigator.platform,
        },
        ...(kind === "sample" ? { presence: telemetryPresence(summary) } : {}),
        payload,
      });
      const artifacts = artifactsRef.current;
      artifacts.push(JSON.stringify(envelope));
      if (artifacts.length > 10_000) {
        artifacts.shift();
      }
      setArtifactCount(artifacts.length);

      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        sendTelemetry(socket, roomId, summary, envelope);
      }
    },
    [endpointId, role, roomId, sessionId, socketRef],
  );

  const publishLifecycle = useCallback(
    (event: string, summary = localStatisticsRef.current): void => {
      publish("event", summary, { ...telemetryPayload(summary), event });
    },
    [localStatisticsRef, publish],
  );

  const recordPeerEnvelope = useCallback((envelope: TelemetryEnvelope): void => {
    const artifacts = artifactsRef.current;
    artifacts.push(JSON.stringify(envelope));
    if (artifacts.length > 10_000) {
      artifacts.shift();
    }
    setArtifactCount(artifacts.length);
  }, []);

  useEffect(() => {
    if (status !== "joined") {
      normalizerRef.current.reset();
      return;
    }
    let cancelled = false;
    let sampling = false;
    const normalizer = normalizerRef.current;
    normalizer.reset();

    const sample = async () => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "telemetry.clockProbe",
            protocolVersion: PROTOCOL_VERSION,
            probeId: crypto.randomUUID(),
            clientSendTimeMs: performance.timeOrigin + performance.now(),
          }),
        );
      }
      const session = mediasoupRef.current;
      if (sampling) {
        return;
      }
      if (!session) {
        publish("sample", localStatisticsRef.current);
        return;
      }
      sampling = true;
      try {
        const [reports, serverStats] = await Promise.all([
          session.getStatsReports(),
          session.getServerStats(),
        ]);
        if (cancelled) {
          return;
        }
        const browserStats = normalizer.sample(reports);
        const appliedPolicy = session.getAppliedProducerPolicy();
        const current = localStatisticsRef.current;
        const next: StatisticsSummary = {
          ...current,
          ...browserStats,
          ...appliedPolicy,
          sourceWidth: browserStats.sourceWidth ?? current.sourceWidth,
          sourceHeight: browserStats.sourceHeight ?? current.sourceHeight,
          captureFps: browserStats.captureFps ?? current.captureFps,
          serverBitrateBps: serverStats.bitrateBps,
          serverAvailableBitrateBps: serverStats.availableBitrateBps,
          serverRttMs: serverStats.rttMs,
          serverPacketLossPercent: serverStats.packetLossPercent,
          serverScore: serverStats.score,
          serverIceState: serverStats.iceState,
          serverDtlsState: serverStats.dtlsState,
          serverTransportProtocol: serverStats.transportProtocol,
          controllerState: current.controllerState,
        };
        localStatisticsRef.current = next;
        setLocalStatistics(next);
        sampleObserver?.current?.(next);
        publish("sample", next);
      } catch {
        // Media may be between lifecycle states; the next sample retries.
      } finally {
        sampling = false;
      }
    };
    const timer = window.setInterval(() => void sample(), 1_000);
    void sample();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      normalizer.reset();
    };
  }, [
    localStatisticsRef,
    mediasoupRef,
    publish,
    sampleObserver,
    setLocalStatistics,
    socketRef,
    status,
  ]);

  const download = useCallback(() => {
    const contents = `${artifactsRef.current.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([contents], { type: "application/x-ndjson" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `screen-share-telemetry-${sessionId}.jsonl`;
    link.click();
    URL.revokeObjectURL(url);
  }, [sessionId]);

  return { artifactCount, download, publish, publishLifecycle, recordPeerEnvelope };
}
