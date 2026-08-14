import type { Role, StatisticsSummary } from "@conference/protocol";
import { formatMetric } from "@conference/telemetry/metrics";
import type { DisplayCaptureReport } from "../capture/index.js";

interface StatisticRow {
  label: string;
  value: string;
}

function bitrate(value: number | null): string {
  return value === null ? "Unavailable" : `${(value / 1_000_000).toFixed(2)} Mbps`;
}

export function dimensions(width: number | null, height: number | null): string {
  return width === null || height === null ? "Unavailable" : `${width} × ${height}`;
}

function capability(value: boolean | null): string {
  return value === null ? "Unavailable" : value ? "Yes" : "No";
}

function compactMetric(value: number | null, suffix: string): string {
  return value === null ? "—" : `${Math.round(value * 10) / 10}${suffix}`;
}

export function TelemetryOverlay({ role, summary }: { role: Role; summary: StatisticsSummary }) {
  const fps =
    role === "host"
      ? (summary.encodeFps ?? summary.captureFps)
      : (summary.presentationFps ?? summary.decodeFps);
  const width = role === "host" ? summary.encodedWidth : summary.decodedWidth;
  const height = role === "host" ? summary.encodedHeight : summary.decodedHeight;
  return (
    <aside className="telemetry-overlay" aria-label="Live video diagnostics">
      <div className="overlay-heading">
        <span className="live-dot" />
        Live diagnostics
      </div>
      <dl>
        <div>
          <dt>Codec</dt>
          <dd>{summary.codec?.replace("video/", "") ?? "—"}</dd>
        </div>
        <div>
          <dt>Video</dt>
          <dd>
            {width === null || height === null ? "—" : `${width}×${height}`} ·{" "}
            {compactMetric(fps, " fps")}
          </dd>
        </div>
        <div>
          <dt>Bitrate</dt>
          <dd>{bitrate(summary.actualBitrateBps)}</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{compactMetric(summary.estimatedLatencyMs ?? summary.rttMs, " ms")}</dd>
        </div>
        <div>
          <dt>Jitter</dt>
          <dd>{compactMetric(summary.jitterMs, " ms")}</dd>
        </div>
      </dl>
    </aside>
  );
}

function statisticRows(summary: StatisticsSummary): StatisticRow[] {
  return [
    { label: "Codec", value: summary.codec ?? "Unavailable" },
    { label: "Source", value: dimensions(summary.sourceWidth, summary.sourceHeight) },
    { label: "Encoded", value: dimensions(summary.encodedWidth, summary.encodedHeight) },
    { label: "Decoded", value: dimensions(summary.decodedWidth, summary.decodedHeight) },
    { label: "Rendered", value: dimensions(summary.renderWidth, summary.renderHeight) },
    { label: "Capture FPS", value: formatMetric(summary.captureFps) },
    { label: "Local preview FPS", value: formatMetric(summary.previewFps) },
    { label: "Encode FPS", value: formatMetric(summary.encodeFps) },
    { label: "Decode FPS", value: formatMetric(summary.decodeFps) },
    { label: "Presentation FPS", value: formatMetric(summary.presentationFps) },
    { label: "Configured bitrate ceiling", value: bitrate(summary.targetBitrateBps) },
    { label: "Encoder target bitrate", value: bitrate(summary.encoderTargetBitrateBps) },
    { label: "Actual bitrate", value: bitrate(summary.actualBitrateBps) },
    {
      label: "Available outgoing bitrate",
      value: bitrate(summary.availableOutgoingBitrateBps),
    },
    { label: "RTT", value: formatMetric(summary.rttMs, " ms") },
    { label: "Minimum RTT", value: formatMetric(summary.minRttMs, " ms") },
    { label: "RTT trend", value: formatMetric(summary.rttTrendMs, " ms/sample") },
    { label: "Jitter", value: formatMetric(summary.jitterMs, " ms") },
    { label: "Jitter buffer delay", value: formatMetric(summary.jitterBufferDelayMs, " ms") },
    { label: "Jitter buffer target", value: formatMetric(summary.jitterBufferTargetMs, " ms") },
    { label: "Packet loss", value: formatMetric(summary.packetLossPercent, "%") },
    { label: "Packets lost", value: formatMetric(summary.packetsLost) },
    { label: "NACK count", value: formatMetric(summary.nackCount) },
    { label: "Retransmitted packets", value: formatMetric(summary.retransmittedPackets) },
    { label: "PLI count", value: formatMetric(summary.pliCount) },
    { label: "FIR count", value: formatMetric(summary.firCount) },
    { label: "Frames encoded", value: formatMetric(summary.framesEncoded) },
    { label: "Frames decoded", value: formatMetric(summary.framesDecoded) },
    { label: "Keyframes encoded", value: formatMetric(summary.keyFramesEncoded) },
    { label: "Keyframes decoded", value: formatMetric(summary.keyFramesDecoded) },
    { label: "Average QP", value: formatMetric(summary.qpAverage) },
    {
      label: "Encode time / frame",
      value: formatMetric(summary.encodeTimeMsPerFrame, " ms"),
    },
    {
      label: "Decode time / frame",
      value: formatMetric(summary.decodeTimeMsPerFrame, " ms"),
    },
    {
      label: "Packet send queue / packet",
      value: formatMetric(summary.packetSendDelayMsPerPacket, " ms"),
    },
    { label: "Dropped frames", value: formatMetric(summary.droppedFrames) },
    { label: "Freeze count", value: formatMetric(summary.freezeCount) },
    { label: "Freeze duration", value: formatMetric(summary.freezeDurationMs, " ms") },
    {
      label: "Frame cadence deviation",
      value: formatMetric(summary.frameCadenceDeviationMs, " ms"),
    },
    { label: "Estimated latency", value: formatMetric(summary.estimatedLatencyMs, " ms") },
    { label: "Latency P50", value: formatMetric(summary.latencyP50Ms, " ms") },
    { label: "Latency P95", value: formatMetric(summary.latencyP95Ms, " ms") },
    { label: "Latency P99", value: formatMetric(summary.latencyP99Ms, " ms") },
    { label: "Clock offset to server", value: formatMetric(summary.clockOffsetMs, " ms") },
    { label: "Clock probe RTT", value: formatMetric(summary.clockProbeRttMs, " ms") },
    {
      label: "Quality limitation",
      value: summary.qualityLimitationReason ?? "Unavailable",
    },
    { label: "Encoder", value: summary.encoderImplementation ?? "Unavailable" },
    { label: "Decoder", value: summary.decoderImplementation ?? "Unavailable" },
    { label: "HDR mode", value: summary.hdrMode ?? "Unavailable" },
    { label: "HDR path", value: summary.hdrStatus ?? "Unavailable" },
    { label: "HDR display", value: capability(summary.displayHdrSupported) },
    { label: "H.264 profile-level-id", value: summary.h264ProfileLevelId ?? "Unavailable" },
    {
      label: "Minimum H.264 level for mode",
      value: summary.requiredH264Level ?? "Unavailable",
    },
    {
      label: "Browser reports encoder supported",
      value: capability(summary.encoderCapabilitySupported),
    },
    {
      label: "Browser reports encoder smooth",
      value: capability(summary.encoderCapabilitySmooth),
    },
    {
      label: "Browser reports hardware efficient",
      value: capability(summary.encoderCapabilityPowerEfficient),
    },
    { label: "Applied max bitrate", value: bitrate(summary.appliedMaxBitrateBps) },
    { label: "Applied max FPS", value: formatMetric(summary.appliedMaxFramerate) },
    { label: "Resolution scale", value: formatMetric(summary.scaleResolutionDownBy, "×") },
    {
      label: "Degradation preference",
      value: summary.degradationPreference ?? "Unavailable",
    },
    { label: "Media flow", value: summary.mediaFlowState ?? "Unavailable" },
    { label: "WebRTC transport state", value: summary.transportState ?? "Unavailable" },
    { label: "ICE state", value: summary.iceState ?? "Unavailable" },
    { label: "DTLS state", value: summary.dtlsState ?? "Unavailable" },
    { label: "Candidate-pair state", value: summary.candidatePairState ?? "Unavailable" },
    {
      label: "ICE candidates (local / remote / pairs)",
      value:
        summary.localCandidateCount === null ||
        summary.remoteCandidateCount === null ||
        summary.candidatePairCount === null
          ? "Unavailable"
          : `${summary.localCandidateCount} / ${summary.remoteCandidateCount} / ${summary.candidatePairCount}`,
    },
    { label: "ICE transport", value: summary.transportProtocol ?? "Unavailable" },
    { label: "SFU RTP bitrate", value: bitrate(summary.serverBitrateBps) },
    { label: "SFU available bitrate", value: bitrate(summary.serverAvailableBitrateBps) },
    { label: "SFU RTP RTT", value: formatMetric(summary.serverRttMs, " ms") },
    { label: "SFU packet loss", value: formatMetric(summary.serverPacketLossPercent, "%") },
    { label: "SFU score", value: formatMetric(summary.serverScore, " / 10") },
    { label: "SFU ICE state", value: summary.serverIceState ?? "Unavailable" },
    { label: "SFU DTLS state", value: summary.serverDtlsState ?? "Unavailable" },
    { label: "SFU transport", value: summary.serverTransportProtocol ?? "Unavailable" },
    { label: "Controller", value: summary.controllerState ?? "Unavailable" },
  ];
}

export function StatisticsCard({ title, summary }: { title: string; summary: StatisticsSummary }) {
  return (
    <section className="statistics-card" aria-label={`${title} statistics`}>
      <h3>{title}</h3>
      <dl>
        {statisticRows(summary).map((row) => (
          <div className="statistic-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function CaptureReport({ report }: { report: DisplayCaptureReport }) {
  const settings = report.settingsAfterConstraints;
  return (
    <details className="capture-report">
      <summary>Capture capability report</summary>
      <dl>
        <div className="statistic-row">
          <dt>Reported maximum</dt>
          <dd>
            {dimensions(report.capabilities.width.max, report.capabilities.height.max)} ·{" "}
            {formatMetric(report.capabilities.frameRate.max, " FPS")}
          </dd>
        </div>
        <div className="statistic-row">
          <dt>Initial picker request</dt>
          <dd>
            {dimensions(
              report.initialConstraints.widthIdeal,
              report.initialConstraints.heightIdeal,
            )}{" "}
            · {formatMetric(report.initialConstraints.frameRateIdeal, " FPS")}
          </dd>
        </div>
        <div className="statistic-row">
          <dt>Post-selection request</dt>
          <dd>
            {dimensions(
              report.requestedConstraints.widthIdeal,
              report.requestedConstraints.heightIdeal,
            )}{" "}
            · {formatMetric(report.requestedConstraints.frameRateIdeal, " FPS")}
          </dd>
        </div>
        <div className="statistic-row">
          <dt>Actual capture</dt>
          <dd>
            {dimensions(settings.width, settings.height)} ·{" "}
            {formatMetric(settings.frameRate, " FPS")}
          </dd>
        </div>
        <div className="statistic-row">
          <dt>Surface</dt>
          <dd>{settings.displaySurface ?? "Unavailable"}</dd>
        </div>
        <div className="statistic-row">
          <dt>Track screenPixelRatio</dt>
          <dd>{formatMetric(settings.screenPixelRatio)}</dd>
        </div>
        <div className="statistic-row">
          <dt>Track resize mode</dt>
          <dd>{settings.resizeMode ?? "Unavailable"}</dd>
        </div>
        <div className="statistic-row">
          <dt>Native scale request</dt>
          <dd>
            {report.nativeScaleMultiplier}× · {report.pixelRatioSource.replaceAll("-", " ")}
          </dd>
        </div>
        <div className="statistic-row">
          <dt>Constraints accepted</dt>
          <dd>{report.constraintsApplied ? "Yes" : "No or unavailable"}</dd>
        </div>
        <div className="statistic-row">
          <dt>Content hint requested / accepted</dt>
          <dd>
            {report.contentHintSupported
              ? `${report.requestedContentHint || "automatic"} / ${
                  report.acceptedContentHint || "automatic"
                }`
              : "Unavailable"}
          </dd>
        </div>
      </dl>
      <p className="report-note">
        Content hints affect encoder behavior; they do not alter the direct local preview’s capture
        size or frame rate.
      </p>
      {report.warnings.length > 0 && (
        <ul className="warnings">
          {report.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
