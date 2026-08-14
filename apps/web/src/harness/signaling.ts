import {
  type MediaRequestMessage,
  type MediaResponseMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
  safeParseServerMessage,
  type VideoCodec,
  type VideoCodecCapabilities,
} from "@conference/protocol";

interface PendingRequest {
  resolve: (message: MediaResponseMessage) => void;
  reject: (error: Error) => void;
  timer: number;
}

export interface HarnessEndpoint {
  events: ServerMessage[];
  request: (message: MediaRequestMessage) => Promise<MediaResponseMessage>;
  socket: WebSocket;
  selectedVideoCodec: VideoCodec | null;
}

function signalingUrl(): string {
  const configured = import.meta.env.VITE_SIGNALING_URL;
  if (configured) {
    return configured;
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws`;
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    wait(milliseconds).then(() => {
      throw new Error(message);
    }),
  ]);
}

export async function createEndpoint(
  roomId: string,
  role: "host" | "viewer",
  videoCodecs: VideoCodecCapabilities,
): Promise<HarnessEndpoint> {
  const socket = new WebSocket(signalingUrl());
  const pending = new Map<string, PendingRequest>();
  const events: ServerMessage[] = [];
  let joinedResolve: ((codec: VideoCodec | null) => void) | null = null;
  const joined = new Promise<VideoCodec | null>((resolve) => {
    joinedResolve = resolve;
  });

  socket.addEventListener("message", (event) => {
    const parsed = safeParseServerMessage(JSON.parse(String(event.data)) as unknown);
    if (!parsed.success) {
      return;
    }
    const message = parsed.data;
    if (message.type === "room.joined") {
      joinedResolve?.(message.selectedVideoCodec ?? null);
      return;
    }
    if ("requestId" in message && typeof message.requestId === "string") {
      const request = pending.get(message.requestId);
      if (request) {
        window.clearTimeout(request.timer);
        pending.delete(message.requestId);
        request.resolve(message as MediaResponseMessage);
      }
      return;
    }
    events.push(message);
  });
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), {
        once: true,
      });
    }),
    5_000,
    `${role} WebSocket did not open within 5 seconds`,
  );
  socket.send(
    JSON.stringify({
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      role,
      endpointId: `${role}-${crypto.randomUUID()}`,
      browser: { name: navigator.userAgent, version: navigator.appVersion, os: navigator.platform },
      videoCodecs,
    }),
  );
  const selectedVideoCodec = await Promise.race([
    joined,
    wait(5_000).then(() => {
      throw new Error(`${role} did not join`);
    }),
  ]);

  return {
    socket,
    events,
    selectedVideoCodec,
    request: (message) =>
      new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(message.requestId);
          reject(new Error(`${message.type} timed out`));
        }, 5_000);
        pending.set(message.requestId, { resolve, reject, timer });
        socket.send(JSON.stringify(message));
      }),
  };
}

export async function waitForProducer(
  events: ServerMessage[],
  kind: "audio" | "video" = "video",
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const index = events.findIndex(
      (candidate) =>
        candidate.type === "media.producerAvailable" && (candidate.kind ?? "video") === kind,
    );
    const event = index < 0 ? undefined : events.splice(index, 1)[0];
    if (event?.type === "media.producerAvailable") {
      return event.producerId;
    }
    await wait(25);
  }
  throw new Error(`Viewer did not receive ${kind} producer availability`);
}
