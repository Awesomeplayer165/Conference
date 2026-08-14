function noiseFrames(width: number, height: number): HTMLCanvasElement[] {
  const scaledWidth = Math.max(1, Math.ceil(width / 4));
  const scaledHeight = Math.max(1, Math.ceil(height / 4));
  return Array.from({ length: 4 }, (_, frameIndex) => {
    const frame = document.createElement("canvas");
    frame.width = scaledWidth;
    frame.height = scaledHeight;
    const context = frame.getContext("2d");
    if (!context) {
      throw new Error("Noise frame canvas unavailable");
    }
    const pixels = context.createImageData(scaledWidth, scaledHeight);
    let seed = (0x9e3779b9 ^ frameIndex) >>> 0;
    for (let index = 0; index < pixels.data.length; index += 4) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels.data[index] = seed & 0xff;
      pixels.data[index + 1] = (seed >>> 8) & 0xff;
      pixels.data[index + 2] = (seed >>> 16) & 0xff;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return frame;
  });
}

interface PatternOptions {
  fps: number;
  height: number;
  pattern: "game" | "screen" | "stress";
  width: number;
}

interface TrackGenerator extends MediaStreamTrack {
  writable: WritableStream<VideoFrame>;
}

type TrackGeneratorConstructor = new (options: { kind: "video" }) => TrackGenerator;

export interface PatternSource {
  canvas: HTMLCanvasElement;
  source: "canvas-capture" | "track-generator";
  stop: () => void;
  track: MediaStreamTrack;
}

function createDrawing(options: PatternOptions) {
  const { height, pattern, width } = options;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context unavailable");
  }
  let frame = 0;
  const stressFrames = pattern === "stress" ? noiseFrames(width, height) : [];
  const gameTexture = pattern === "game" ? noiseFrames(width, height)[0] : null;
  context.imageSmoothingEnabled = false;

  const draw = () => {
    frame += 1;
    if (pattern === "stress") {
      context.drawImage(
        stressFrames[frame % stressFrames.length] as HTMLCanvasElement,
        0,
        0,
        width,
        height,
      );
    } else {
      context.fillStyle = "#10273a";
      context.fillRect(0, 0, width, height);
      if (gameTexture) {
        const horizontalOffset = (frame * Math.max(8, Math.round(width / 300))) % width;
        context.globalAlpha = 0.52;
        context.drawImage(gameTexture, -horizontalOffset, 0, width, height);
        context.drawImage(gameTexture, width - horizontalOffset, 0, width, height);
        context.globalAlpha = 1;
      }
      const cell = Math.max(24, Math.round(width / 32));
      const offset = (frame * 3) % cell;
      context.strokeStyle = "#2b4e66";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = -cell + offset; x < width; x += cell) {
        context.moveTo(x, 0);
        context.lineTo(x, height);
      }
      for (let y = -cell + offset; y < height; y += cell) {
        context.moveTo(0, y);
        context.lineTo(width, y);
      }
      context.stroke();
      for (let index = 0; index < 12; index += 1) {
        const panelWidth = width / 7;
        const panelHeight = height / 8;
        const x =
          ((frame * (index + 2) * 2 + index * panelWidth) % (width + panelWidth)) - panelWidth;
        const y = ((index + 1) * height) / 14;
        context.fillStyle = `hsl(${(index * 37 + frame * 2) % 360} 65% 48%)`;
        context.fillRect(x, y, panelWidth, panelHeight);
      }
    }
    context.fillStyle = "white";
    context.font = `${Math.max(24, Math.round(height / 12))}px system-ui`;
    context.fillText(`Media probe · ${frame}`, Math.round(width / 20), Math.round(height / 2));
  };
  return { canvas, draw };
}

function startGeneratedTrack(options: PatternOptions, drawing: ReturnType<typeof createDrawing>) {
  const Constructor = (
    globalThis as unknown as {
      MediaStreamTrackGenerator?: TrackGeneratorConstructor;
    }
  ).MediaStreamTrackGenerator;
  if (!Constructor || typeof VideoFrame !== "function") {
    return null;
  }
  const track = new Constructor({ kind: "video" });
  const writer = track.writable.getWriter();
  const frameDurationUs = Math.round(1_000_000 / options.fps);
  let stopped = false;
  let timestampUs = 0;
  let nextFrameAt = performance.now();
  const pump = async () => {
    while (!stopped) {
      drawing.draw();
      const frame = new VideoFrame(drawing.canvas, {
        duration: frameDurationUs,
        timestamp: timestampUs,
      });
      timestampUs += frameDurationUs;
      try {
        await writer.write(frame);
      } catch {
        stopped = true;
      } finally {
        frame.close();
      }
      nextFrameAt += 1_000 / options.fps;
      if (nextFrameAt < performance.now() - 1_000 / options.fps) {
        nextFrameAt = performance.now();
      }
      const delay = nextFrameAt - performance.now();
      if (!stopped && delay > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }
    await writer.close().catch(() => undefined);
  };
  void pump();
  return {
    source: "track-generator" as const,
    stop: () => {
      stopped = true;
    },
    track,
  };
}

export function startPatternSource(options: PatternOptions): PatternSource {
  const drawing = createDrawing(options);
  const generated = startGeneratedTrack(options, drawing);
  if (generated) {
    return { canvas: drawing.canvas, ...generated };
  }

  let stopped = false;
  let animationHandle = 0;
  let nextFrameAt = performance.now();
  const animate = () => {
    if (stopped) {
      return;
    }
    drawing.draw();
    nextFrameAt += 1_000 / options.fps;
    if (nextFrameAt < performance.now() - 1_000 / options.fps) {
      nextFrameAt = performance.now();
    }
    animationHandle = window.setTimeout(animate, Math.max(0, nextFrameAt - performance.now()));
  };
  animate();
  const track = drawing.canvas.captureStream(options.fps).getVideoTracks()[0];
  if (!track) {
    throw new Error("Canvas capture track unavailable");
  }
  return {
    canvas: drawing.canvas,
    source: "canvas-capture",
    stop: () => {
      stopped = true;
      window.clearTimeout(animationHandle);
    },
    track,
  };
}
