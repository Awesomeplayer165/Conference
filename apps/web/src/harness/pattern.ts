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

export interface PatternCanvas {
  canvas: HTMLCanvasElement;
  stop: () => void;
}

export function startPatternCanvas(options: PatternOptions): PatternCanvas {
  const { fps, height, pattern, width } = options;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context unavailable");
  }
  let frame = 0;
  let animationHandle = 0;
  const useAnimationFrame = !navigator.userAgent.toLowerCase().includes("firefox");
  const stressFrames = pattern === "stress" ? noiseFrames(width, height) : [];
  const gameTexture = pattern === "game" ? noiseFrames(width, height)[0] : null;
  context.imageSmoothingEnabled = false;
  const animate = () => {
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
      for (let x = -cell + offset; x < width; x += cell) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = -cell + offset; y < height; y += cell) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
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
    animationHandle = useAnimationFrame
      ? window.requestAnimationFrame(animate)
      : window.setTimeout(animate, 1_000 / fps);
  };
  animate();
  return {
    canvas,
    stop: () => {
      if (useAnimationFrame) {
        window.cancelAnimationFrame(animationHandle);
      } else {
        window.clearTimeout(animationHandle);
      }
    },
  };
}
