import type { VideoCodec, VideoCodecCapabilities } from "@conference/protocol";
import { WebRtcStatsNormalizer } from "@conference/telemetry";
import { startPatternCanvas } from "./harness/pattern.js";
import { createEndpoint, wait, waitForProducer, withTimeout } from "./harness/signaling.js";
import { requiredH264Level } from "./media/h264Capability.js";
import { MediasoupSession } from "./media/MediasoupSession.js";
import { detectVideoCodecCapabilities, displayVideoCodec } from "./media/videoCodecs.js";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Stage 3 harness element missing: ${selector}`);
  }
  return element;
}

const runButton = requiredElement<HTMLButtonElement>("#run");
const resultElement = requiredElement<HTMLPreElement>("#result");
const remoteVideo = requiredElement<HTMLVideoElement>("#remote");

function numericParameter(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

async function presentationFps(video: HTMLVideoElement): Promise<number | null> {
  if (typeof video.requestVideoFrameCallback !== "function") {
    return null;
  }
  return new Promise((resolve) => {
    let startedAt: number | null = null;
    let startingFrames = 0;
    const measure: VideoFrameRequestCallback = (now, metadata) => {
      if (startedAt === null) {
        startedAt = now;
        startingFrames = metadata.presentedFrames;
      }
      const elapsed = now - startedAt;
      if (elapsed >= 1_000) {
        resolve(
          Number((((metadata.presentedFrames - startingFrames) * 1_000) / elapsed).toFixed(1)),
        );
        return;
      }
      video.requestVideoFrameCallback(measure);
    };
    video.requestVideoFrameCallback(measure);
  });
}

async function runProbe(): Promise<Record<string, unknown>> {
  const width = Math.round(numericParameter("width", 1_280, 16, 7_680));
  const height = Math.round(numericParameter("height", 720, 16, 4_320));
  const fps = numericParameter("fps", 60, 1, 240);
  const maxBitrateBps = Math.round(numericParameter("bitrateMbps", 4, 0.25, 100) * 1_000_000);
  const sampleSeconds = numericParameter("sampleSeconds", 3, 1, 30);
  const pattern =
    new URLSearchParams(window.location.search).get("pattern") === "stress" ? "stress" : "screen";
  const requestedCodec = new URLSearchParams(window.location.search).get("codec");
  const detectedVideoCodecs = detectVideoCodecCapabilities();
  const forcedCodec: VideoCodec | null =
    requestedCodec === "av1" ? "video/AV1" : requestedCodec === "h264" ? "video/H264" : null;
  const advertisedVideoCodecs: VideoCodecCapabilities = forcedCodec
    ? {
        send: detectedVideoCodecs.send.filter((codec) => codec === forcedCodec),
        receive: detectedVideoCodecs.receive.filter((codec) => codec === forcedCodec),
      }
    : detectedVideoCodecs;
  const roomId = `stage3-${crypto.randomUUID()}`;
  resultElement.textContent = "Opening viewer signaling…";
  const viewer = await createEndpoint(roomId, "viewer", advertisedVideoCodecs);
  resultElement.textContent = "Opening host signaling…";
  const host = await createEndpoint(roomId, "host", advertisedVideoCodecs);
  const selectedVideoCodec = host.selectedVideoCodec;
  if (!selectedVideoCodec) {
    host.socket.close();
    viewer.socket.close();
    throw new Error(
      `No routed codec matched browser capabilities: ${JSON.stringify(advertisedVideoCodecs)}`,
    );
  }
  const codecLabel = displayVideoCodec(selectedVideoCodec);
  let remoteTrack: MediaStreamTrack | null = null;
  const hostStates: string[] = [];
  const viewerStates: string[] = [];
  const viewerSession = new MediasoupSession(viewer.request, {
    onState: (state) => viewerStates.push(state),
    onRemoteTrack: (track) => {
      remoteTrack = track;
    },
  });
  const hostSession = new MediasoupSession(host.request, {
    onState: (state) => hostStates.push(state),
    onRemoteTrack: () => undefined,
  });
  const patternCanvas = startPatternCanvas({ fps, height, pattern, width });
  const track = patternCanvas.canvas.captureStream(fps).getVideoTracks()[0];
  if (!track) {
    throw new Error("Canvas capture track unavailable");
  }
  if ("contentHint" in track) {
    track.contentHint = "motion";
  }

  try {
    resultElement.textContent = `Negotiating ${codecLabel} producer…`;
    await withTimeout(
      hostSession.startProducing(track, { maxBitrateBps, maxFps: fps }, selectedVideoCodec),
      10_000,
      `${codecLabel} producer did not start within 10 seconds`,
    );
    resultElement.textContent = `Negotiating ${codecLabel} consumer…`;
    await withTimeout(
      viewerSession.consume(await waitForProducer(viewer.events)),
      10_000,
      `${codecLabel} consumer did not start within 10 seconds`,
    );
    if (!remoteTrack) {
      throw new Error("Consumer did not expose a remote track");
    }
    remoteVideo.srcObject = new MediaStream([remoteTrack]);
    resultElement.textContent = `Waiting for first decoded ${codecLabel} frame…`;
    await withTimeout(
      remoteVideo.play(),
      5_000,
      `Remote ${codecLabel} video playback did not start within 5 seconds`,
    );
    await Promise.race([
      new Promise<void>((resolve) => {
        if (remoteVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          resolve();
          return;
        }
        remoteVideo.addEventListener("loadeddata", () => resolve(), { once: true });
      }),
      wait(10_000).then(() => {
        throw new Error("Remote video did not decode a frame within 10 seconds");
      }),
    ]);

    const hostNormalizer = new WebRtcStatsNormalizer();
    const viewerNormalizer = new WebRtcStatsNormalizer();
    hostNormalizer.sample(await hostSession.getStatsReports());
    viewerNormalizer.sample(await viewerSession.getStatsReports());
    const measuredPresentationFps = Promise.race([
      presentationFps(remoteVideo),
      wait(4_000).then(() => null),
    ]);
    resultElement.textContent = "Sampling browser and SFU media stats…";
    await wait(sampleSeconds * 1_000);
    const hostStats = hostNormalizer.sample(await hostSession.getStatsReports());
    const viewerStats = viewerNormalizer.sample(await viewerSession.getStatsReports());
    const applied = hostSession.getAppliedProducerPolicy();

    return {
      passed:
        hostSession.producer?.rtpParameters.codecs[0]?.mimeType === selectedVideoCodec &&
        viewerSession.consumer?.rtpParameters.codecs[0]?.mimeType === selectedVideoCodec &&
        remoteVideo.videoWidth === width &&
        remoteVideo.videoHeight === height &&
        (hostStats.actualBitrateBps ?? 0) > 0 &&
        (hostStats.encodeFps ?? 0) >= fps * 0.75 &&
        (viewerStats.decodeFps ?? 0) >= fps * 0.75,
      requested: {
        width,
        height,
        fps,
        maxBitrateBps,
        sampleSeconds,
        pattern,
        codec: requestedCodec ?? "auto",
      },
      detectedVideoCodecs,
      selectedVideoCodec,
      captureSettings: track.getSettings(),
      requiredH264Level:
        selectedVideoCodec === "video/H264" ? requiredH264Level(width, height, fps) : null,
      producerCodec: hostSession.producer?.rtpParameters.codecs[0]?.mimeType ?? null,
      consumerCodec: viewerSession.consumer?.rtpParameters.codecs[0]?.mimeType ?? null,
      remoteDimensions: [remoteVideo.videoWidth, remoteVideo.videoHeight],
      hostStats,
      viewerStats,
      applied,
      presentationFps: await measuredPresentationFps,
      hostStates,
      viewerStates,
    };
  } catch (error) {
    const [hostReports, viewerReports, hostServerStats, viewerServerStats] = await Promise.all([
      hostSession
        .getStatsReports()
        .catch(() => ({ sender: null, receiver: null, transport: null })),
      viewerSession
        .getStatsReports()
        .catch(() => ({ sender: null, receiver: null, transport: null })),
      hostSession.getServerStats().catch(() => null),
      viewerSession.getServerStats().catch(() => null),
    ]);
    return {
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      requested: {
        width,
        height,
        fps,
        maxBitrateBps,
        sampleSeconds,
        pattern,
        codec: requestedCodec ?? "auto",
      },
      detectedVideoCodecs,
      selectedVideoCodec,
      captureSettings: track.getSettings(),
      requiredH264Level:
        selectedVideoCodec === "video/H264" ? requiredH264Level(width, height, fps) : null,
      producerCodec: hostSession.producer?.rtpParameters.codecs[0] ?? null,
      consumerCodec: viewerSession.consumer?.rtpParameters.codecs[0] ?? null,
      applied: hostSession.getAppliedProducerPolicy(),
      hostStats: new WebRtcStatsNormalizer().sample(hostReports),
      viewerStats: new WebRtcStatsNormalizer().sample(viewerReports),
      hostServerStats,
      viewerServerStats,
      remoteDimensions: [remoteVideo.videoWidth, remoteVideo.videoHeight],
      hostStates,
      viewerStates,
    };
  } finally {
    patternCanvas.stop();
    track.stop();
    await hostSession.stopProducing().catch(() => undefined);
    hostSession.close();
    viewerSession.close();
    host.socket.close();
    viewer.socket.close();
    remoteVideo.srcObject = null;
  }
}

function startProbe(): void {
  runButton.disabled = true;
  resultElement.textContent = "Running…";
  void runProbe()
    .then((result) => {
      resultElement.textContent = JSON.stringify(result, null, 2);
      document.title = result.passed
        ? "PASS · Stage 3 Browser Harness"
        : "FAIL · Stage 3 Browser Harness";
    })
    .catch((error: unknown) => {
      resultElement.textContent = JSON.stringify(
        { passed: false, error: error instanceof Error ? error.message : String(error) },
        null,
        2,
      );
    })
    .finally(() => {
      runButton.disabled = false;
    });
}

runButton.addEventListener("click", startProbe);
if (new URLSearchParams(window.location.search).get("autorun") === "1") {
  startProbe();
}
