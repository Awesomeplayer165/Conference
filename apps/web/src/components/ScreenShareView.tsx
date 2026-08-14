import type {
  Role,
  StatisticsSummary,
  VideoCodec,
  VideoCodecCapabilities,
} from "@conference/protocol";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { DisplayCaptureReport } from "../capture/index.js";
import type { HostMediaSettings } from "../media/hostSettings.js";
import { displayVideoCodec } from "../media/videoCodecs.js";
import { normalizeSessionCode } from "../sessionCode.js";
import { CaptureReport, StatisticsCard, TelemetryOverlay } from "./Diagnostics.js";
import { QualityPanel } from "./QualityPanel.js";

export type ConnectionStatus = "idle" | "connecting" | "joined" | "error";

export interface ScreenShareViewProps {
  captureActive: boolean;
  captureMessage: string;
  captureReport: DisplayCaptureReport | null;
  chooseRole: (role: Role) => void;
  clearCapture: (message: string) => void;
  codeCopied: boolean;
  copySessionCode: () => Promise<void>;
  debugOverlayEnabled: boolean;
  downloadTelemetry: () => void;
  hostSettings: HostMediaSettings;
  hdrOutputEnabled: boolean;
  hdrStatus: string;
  joinRoom: () => void;
  joined: boolean;
  leaveRoom: () => void;
  localStatistics: StatisticsSummary;
  localVideoCodecs: VideoCodecCapabilities;
  mediaStatus: string;
  peerPresent: boolean;
  peerStatistics: StatisticsSummary;
  regenerateSessionCode: () => void;
  remoteActive: boolean;
  remoteAudioActive: boolean;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  role: Role;
  roomId: string;
  selectedVideoCodec: VideoCodec | null;
  sessionCodeReady: boolean;
  setAutomaticBitrate: (automatic: boolean) => void;
  setDebugOverlayEnabled: Dispatch<SetStateAction<boolean>>;
  setHostSettings: Dispatch<SetStateAction<HostMediaSettings>>;
  setRoomId: Dispatch<SetStateAction<string>>;
  shareScreen: () => Promise<void>;
  status: ConnectionStatus;
  statusMessage: string;
  telemetryArtifactCount: number;
  updateRemoteGeometry: () => void;
  updateRenderGeometry: () => void;
  videoActive: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
}

function AppHeader(props: ScreenShareViewProps) {
  const { captureActive, joined, peerPresent, remoteActive, role, status } = props;
  const connectionLabel = joined
    ? role === "host"
      ? captureActive
        ? "Sharing"
        : peerPresent
          ? "Viewer ready"
          : "Session ready"
      : remoteActive
        ? "Viewing"
        : "Connected"
    : status === "connecting"
      ? "Connecting"
      : status === "error"
        ? "Needs attention"
        : "Ready";
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <div>
          <p className="brand-name">Screen Share</p>
          <p className="brand-description">Private, high-quality screen viewing</p>
        </div>
      </div>
      <div className={`connection-state connection-state-${status}`}>
        <span className="connection-dot" />
        {connectionLabel}
      </div>
    </header>
  );
}

function SessionEntry(props: ScreenShareViewProps) {
  const {
    chooseRole,
    codeCopied,
    copySessionCode,
    joinRoom,
    regenerateSessionCode,
    role,
    roomId,
    sessionCodeReady,
    setRoomId,
    status,
    statusMessage,
  } = props;
  return (
    <section className="session-entry" aria-labelledby="session-heading">
      <div className="session-intro">
        <p className="eyebrow">One screen. One viewer.</p>
        <h1 id="session-heading">
          {role === "host" ? "Share your screen with confidence." : "Join a screen share."}
        </h1>
        <p className="lede">
          {role === "host"
            ? "Create a private session, send the code to your viewer, and choose exactly what to share."
            : "Enter the code from the person sharing their screen. Nothing is installed or recorded."}
        </p>
      </div>

      <div className="session-card">
        <fieldset className="role-switch">
          <legend className="visually-hidden">Choose how to use Screen Share</legend>
          <button
            className={role === "host" ? "role-option role-option-active" : "role-option"}
            disabled={status === "connecting"}
            onClick={() => chooseRole("host")}
            type="button"
          >
            Share a screen
          </button>
          <button
            className={role === "viewer" ? "role-option role-option-active" : "role-option"}
            disabled={status === "connecting"}
            onClick={() => chooseRole("viewer")}
            type="button"
          >
            Join a session
          </button>
        </fieldset>

        {role === "host" ? (
          <div className="host-code-block">
            <span className="field-label">Your session code</span>
            <output className="session-code" aria-label={`Session code ${roomId}`}>
              {roomId}
            </output>
            <p>Share this code with the one person who should view your screen.</p>
            <div className="inline-actions">
              <button
                className="secondary compact"
                onClick={() => void copySessionCode()}
                type="button"
              >
                {codeCopied ? "Copied" : "Copy code"}
              </button>
              <button className="quiet compact" onClick={regenerateSessionCode} type="button">
                New code
              </button>
            </div>
          </div>
        ) : (
          <label className="session-code-input">
            Session code
            <input
              autoComplete="off"
              inputMode="text"
              maxLength={7}
              onChange={(event) => setRoomId(normalizeSessionCode(event.target.value))}
              placeholder="ABC-DEF"
              spellCheck={false}
              value={roomId}
            />
          </label>
        )}

        <button
          className="primary-action"
          disabled={status === "connecting" || !sessionCodeReady}
          onClick={joinRoom}
          type="button"
        >
          {status === "connecting"
            ? "Connecting…"
            : role === "host"
              ? "Create session"
              : "Join session"}
        </button>
        <p className={`entry-status status-${status}`} role="status">
          {statusMessage}
        </p>
      </div>
    </section>
  );
}

function SessionWorkspace(props: ScreenShareViewProps) {
  const {
    captureActive,
    clearCapture,
    codeCopied,
    copySessionCode,
    debugOverlayEnabled,
    leaveRoom,
    localStatistics,
    peerPresent,
    remoteActive,
    remoteAudioActive,
    remoteVideoRef,
    role,
    roomId,
    hdrOutputEnabled,
    hdrStatus,
    shareScreen,
    statusMessage,
    updateRemoteGeometry,
    updateRenderGeometry,
    videoActive,
    videoRef,
  } = props;
  return (
    <div className="session-workspace">
      <section className="session-strip" aria-label="Active session">
        <div>
          <span className="field-label">Session code</span>
          <strong>{roomId}</strong>
        </div>
        <p>{statusMessage}</p>
        <div className="session-strip-actions">
          {role === "host" && (
            <button
              className="secondary compact"
              onClick={() => void copySessionCode()}
              type="button"
            >
              {codeCopied ? "Copied" : "Copy code"}
            </button>
          )}
          <button className="quiet compact" onClick={leaveRoom} type="button">
            {role === "host" ? "End session" : "Leave session"}
          </button>
        </div>
      </section>

      <section className="video-panel" aria-labelledby="video-heading">
        <div className="video-panel-heading">
          <div>
            <p className="eyebrow">{role === "host" ? "Your screen" : "Shared with you"}</p>
            <h2 id="video-heading">{role === "host" ? "Local preview" : "Shared screen"}</h2>
            <p className="video-format-status">{hdrStatus}</p>
          </div>
          {role === "host" && videoActive && (
            <button
              className="stop-action compact"
              onClick={() => clearCapture("Sharing stopped.")}
              type="button"
            >
              Stop sharing
            </button>
          )}
        </div>
        <div className={videoActive ? "video-stage video-stage-active" : "video-stage"}>
          {role === "host" ? (
            <video
              autoPlay
              className={`${captureActive ? "capture-video" : "capture-video hidden"} ${
                hdrOutputEnabled ? "hdr-output" : "sdr-output"
              }`}
              muted
              onLoadedMetadata={updateRenderGeometry}
              playsInline
              ref={videoRef}
            />
          ) : (
            <video
              autoPlay
              className={`${remoteActive ? "capture-video" : "capture-video hidden"} ${
                hdrOutputEnabled ? "hdr-output" : "sdr-output"
              }`}
              muted={false}
              onClick={(event) => void event.currentTarget.play()}
              onLoadedMetadata={updateRemoteGeometry}
              playsInline
              ref={remoteVideoRef}
            />
          )}
          {!videoActive && (
            <div className="video-empty-state">
              <span className="screen-glyph" aria-hidden="true" />
              <h3>{role === "host" ? "Choose a screen to share" : "Waiting for the host"}</h3>
              <p>
                {role === "host"
                  ? peerPresent
                    ? "Your viewer is ready. Choose a screen, window, or browser tab."
                    : "You can prepare your screen now; sharing begins when a viewer joins."
                  : "The shared screen will appear here automatically."}
              </p>
              {role === "host" && (
                <button
                  className="primary-action inline-primary"
                  onClick={() => void shareScreen()}
                  type="button"
                >
                  Choose screen
                </button>
              )}
            </div>
          )}
          {debugOverlayEnabled && videoActive && (
            <TelemetryOverlay role={role} summary={localStatistics} />
          )}
          {role === "viewer" && remoteAudioActive && (
            <span className="audio-status">Display audio</span>
          )}
        </div>
      </section>
      {role === "host" && <QualityPanel {...props} />}
    </div>
  );
}

function DebugPanel(props: ScreenShareViewProps) {
  const {
    captureMessage,
    captureReport,
    debugOverlayEnabled,
    downloadTelemetry,
    localStatistics,
    localVideoCodecs,
    mediaStatus,
    peerStatistics,
    role,
    selectedVideoCodec,
    setDebugOverlayEnabled,
    telemetryArtifactCount,
  } = props;
  return (
    <details className="debug-panel">
      <summary>Debug settings</summary>
      <div className="debug-panel-content">
        <label className="checkbox-label">
          <input
            checked={debugOverlayEnabled}
            onChange={(event) => setDebugOverlayEnabled(event.target.checked)}
            type="checkbox"
          />
          Show live diagnostics over the video
        </label>
        <p className="debug-note">
          {captureMessage} · {mediaStatus} · Local codecs:{" "}
          {localVideoCodecs.send.map(displayVideoCodec).join(", ") || "none"}
          {selectedVideoCodec ? ` · Active codec: ${displayVideoCodec(selectedVideoCodec)}` : ""}
        </p>
        <div className="inline-actions">
          <button
            className="secondary compact"
            disabled={telemetryArtifactCount === 0}
            onClick={downloadTelemetry}
            type="button"
          >
            Download telemetry ({telemetryArtifactCount})
          </button>
        </div>
        {captureReport && <CaptureReport report={captureReport} />}
        <details className="statistics-panel">
          <summary>Detailed statistics</summary>
          <div className="statistics-grid">
            <StatisticsCard title={`Local ${role}`} summary={localStatistics} />
            <StatisticsCard
              title={`Remote ${role === "host" ? "viewer" : "host"}`}
              summary={peerStatistics}
            />
          </div>
        </details>
      </div>
    </details>
  );
}

export function ScreenShareView(props: ScreenShareViewProps) {
  return (
    <main className={props.joined ? "app-shell app-shell-active" : "app-shell"}>
      <AppHeader {...props} />
      {props.joined ? <SessionWorkspace {...props} /> : <SessionEntry {...props} />}
      <DebugPanel {...props} />
    </main>
  );
}
