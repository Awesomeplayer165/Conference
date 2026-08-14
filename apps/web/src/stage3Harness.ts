import {
  createEmptyStatisticsSummary,
  type StatisticsSummary,
  type VideoCodec,
  type VideoCodecCapabilities,
} from "@conference/protocol";
import { WebRtcStatsNormalizer } from "@conference/telemetry";
import { startPatternCanvas } from "./harness/pattern.js";
import { createEndpoint, wait, waitForProducer, withTimeout } from "./harness/signaling.js";
import {
  type BalancedControllerAction,
  BalancedMediaController,
} from "./media/balancedController.js";
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

async function waitForDecodedFrame(codecLabel: string): Promise<void> {
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
}

function minimum(samples: Partial<StatisticsSummary>[], key: keyof StatisticsSummary): number {
  const values = samples
    .map((sample) => sample[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length === 0 ? 0 : Math.min(...values);
}

interface ProbeCycleOptions {
  codec: VideoCodec;
  codecLabel: string;
  cycle: number;
  fps: number;
  getRemoteTrack: () => MediaStreamTrack | null;
  height: number;
  hostSession: MediasoupSession;
  maxBitrateBps: number;
  minBitrateBps: number;
  sampleSeconds: number;
  track: MediaStreamTrack;
  viewerEvents: Parameters<typeof waitForProducer>[0];
  viewerSession: MediasoupSession;
  warmupSeconds: number;
  width: number;
}

async function runCycle(options: ProbeCycleOptions): Promise<Record<string, unknown>> {
  const {
    codec,
    codecLabel,
    cycle,
    fps,
    getRemoteTrack,
    height,
    hostSession,
    maxBitrateBps,
    minBitrateBps,
    sampleSeconds,
    track,
    viewerEvents,
    viewerSession,
    warmupSeconds,
    width,
  } = options;
  resultElement.textContent = `Cycle ${cycle}: negotiating ${codecLabel} producer…`;
  remoteVideo.srcObject = null;
  let producerSettings = {
    contentMode: "motion" as const,
    maxBitrateBps,
    maxFps: fps,
    minBitrateBps: Math.min(maxBitrateBps, Math.round(maxBitrateBps * 0.35)),
    scaleResolutionDownBy: 1,
  };
  await withTimeout(
    hostSession.startProducing(track, producerSettings, codec),
    10_000,
    `${codecLabel} producer did not start within 10 seconds`,
  );
  resultElement.textContent = `Cycle ${cycle}: negotiating ${codecLabel} consumer…`;
  await withTimeout(
    viewerSession.consume(await waitForProducer(viewerEvents)),
    10_000,
    `${codecLabel} consumer did not start within 10 seconds`,
  );
  const remoteTrack = getRemoteTrack();
  if (!remoteTrack) {
    throw new Error("Consumer did not expose a remote track");
  }
  remoteVideo.srcObject = new MediaStream([remoteTrack]);
  resultElement.textContent = `Cycle ${cycle}: waiting for the first decoded frame…`;
  await waitForDecodedFrame(codecLabel);

  const hostNormalizer = new WebRtcStatsNormalizer();
  const viewerNormalizer = new WebRtcStatsNormalizer();
  hostNormalizer.sample(await hostSession.getStatsReports());
  viewerNormalizer.sample(await viewerSession.getStatsReports());
  const controller = new BalancedMediaController();
  const controllerActions: BalancedControllerAction[] = [];
  const observeController = async (sample: Partial<StatisticsSummary>) => {
    const action = controller.observe(
      { ...createEmptyStatisticsSummary(), ...sample },
      {
        automaticBitrate: true,
        maxBitrateBps: producerSettings.maxBitrateBps,
        maxFps: producerSettings.maxFps,
        scaleResolutionDownBy: producerSettings.scaleResolutionDownBy,
      },
    );
    if (action.type === "scale") {
      producerSettings = {
        ...producerSettings,
        scaleResolutionDownBy: action.scaleResolutionDownBy,
      };
      await hostSession.updateProducerSettings(producerSettings);
      controllerActions.push(action);
    } else if (action.type === "bitrate") {
      producerSettings = { ...producerSettings, maxBitrateBps: action.maxBitrateBps };
      await hostSession.updateProducerSettings(producerSettings);
      controllerActions.push(action);
    }
  };
  for (let second = 1; second <= warmupSeconds; second += 1) {
    resultElement.textContent = `Cycle ${cycle}: adaptive warm-up ${second}/${warmupSeconds}…`;
    await wait(1_000);
    await observeController(hostNormalizer.sample(await hostSession.getStatsReports()));
    viewerNormalizer.sample(await viewerSession.getStatsReports());
  }
  const hostSamples: Partial<StatisticsSummary>[] = [];
  const viewerSamples: Partial<StatisticsSummary>[] = [];
  for (let second = 1; second <= sampleSeconds; second += 1) {
    resultElement.textContent = `Cycle ${cycle}: sustained sample ${second}/${sampleSeconds}…`;
    await wait(1_000);
    const hostSample = hostNormalizer.sample(await hostSession.getStatsReports());
    hostSamples.push(hostSample);
    viewerSamples.push(viewerNormalizer.sample(await viewerSession.getStatsReports()));
    await observeController(hostSample);
  }
  const presentation = await Promise.race([
    presentationFps(remoteVideo),
    wait(4_000).then(() => null),
  ]);
  const minEncodeFps = minimum(hostSamples, "encodeFps");
  const minDecodeFps = minimum(viewerSamples, "decodeFps");
  const stableEncodeFps = minimum(hostSamples.slice(-3), "encodeFps");
  const stableDecodeFps = minimum(viewerSamples.slice(-3), "decodeFps");
  const minActualBitrateBps = minimum(hostSamples, "actualBitrateBps");
  const remoteDimensions = [remoteVideo.videoWidth, remoteVideo.videoHeight];
  const resolutionRatio = Math.min(
    remoteVideo.videoWidth / width,
    remoteVideo.videoHeight / height,
  );
  const passed =
    hostSession.producer?.rtpParameters.codecs[0]?.mimeType === codec &&
    viewerSession.consumer?.rtpParameters.codecs[0]?.mimeType === codec &&
    resolutionRatio >= 0.24 &&
    minActualBitrateBps >= minBitrateBps &&
    stableEncodeFps >= fps * 0.9 &&
    stableDecodeFps >= fps * 0.9 &&
    (presentation === null || presentation >= fps * 0.85);
  const result = {
    cycle,
    passed,
    minEncodeFps,
    minDecodeFps,
    stableEncodeFps,
    stableDecodeFps,
    minActualBitrateBps,
    presentationFps: presentation,
    remoteDimensions,
    resolutionRatio: Number(resolutionRatio.toFixed(3)),
    hostSamples,
    viewerSamples,
    applied: hostSession.getAppliedProducerPolicy(),
    viewerApplied: viewerSession.getAppliedProducerPolicy(),
    controllerActions,
  };
  await hostSession.stopProducing();
  viewerSession.stopConsuming();
  remoteVideo.srcObject = null;
  await wait(100);
  return result;
}

async function runProbe(): Promise<Record<string, unknown>> {
  const width = Math.round(numericParameter("width", 1_280, 16, 7_680));
  const height = Math.round(numericParameter("height", 720, 16, 4_320));
  const fps = numericParameter("fps", 60, 1, 240);
  const maxBitrateBps = Math.round(numericParameter("bitrateMbps", 4, 0.25, 100) * 1_000_000);
  const minBitrateBps = Math.round(numericParameter("minBitrateMbps", 0.01, 0, 100) * 1_000_000);
  const sampleSeconds = numericParameter("sampleSeconds", 3, 1, 30);
  const warmupSeconds = numericParameter("warmupSeconds", 2, 0, 10);
  const cycles = Math.round(numericParameter("cycles", 1, 1, 10));
  const query = new URLSearchParams(window.location.search);
  const patternParameter = query.get("pattern");
  const pattern =
    patternParameter === "stress" || patternParameter === "game" ? patternParameter : "screen";
  const requestedCodec = query.get("codec");
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
    const cycleResults: Record<string, unknown>[] = [];
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      cycleResults.push(
        await runCycle({
          codec: selectedVideoCodec,
          codecLabel,
          cycle,
          fps,
          getRemoteTrack: () => remoteTrack,
          height,
          hostSession,
          maxBitrateBps,
          minBitrateBps,
          sampleSeconds,
          track,
          viewerEvents: viewer.events,
          viewerSession,
          warmupSeconds,
          width,
        }),
      );
    }
    return {
      passed: cycleResults.every((result) => result.passed === true),
      requested: {
        width,
        height,
        fps,
        maxBitrateBps,
        minBitrateBps,
        cycles,
        sampleSeconds,
        warmupSeconds,
        pattern,
        codec: requestedCodec ?? "auto",
      },
      detectedVideoCodecs,
      selectedVideoCodec,
      captureSettings: track.getSettings(),
      requiredH264Level:
        selectedVideoCodec === "video/H264" ? requiredH264Level(width, height, fps) : null,
      cycleResults,
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
        minBitrateBps,
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
      viewerApplied: viewerSession.getAppliedProducerPolicy(),
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
