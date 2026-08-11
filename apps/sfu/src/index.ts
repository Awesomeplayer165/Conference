import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PROTOCOL_VERSION, safeParseClientMessage } from "@conference/protocol";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import type { WSContext, WSMessageReceive } from "hono/ws";
import { handleMediaRequest } from "./mediaRequests.js";
import { MediaService } from "./mediaService.js";
import {
  connectionKey,
  connectionMetadata,
  handleJoin,
  handleLeave,
  oppositeRole,
  peerForRole,
  rooms,
  send,
} from "./roomState.js";

let mediaService: MediaService | null = null;

async function messageText(data: WSMessageReceive): Promise<string | null> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Blob) {
    return data.text();
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  return null;
}

async function handleMessage(socket: WSContext, rawMessage: WSMessageReceive): Promise<void> {
  const serverReceiveTimeMs = Date.now();
  const text = await messageText(rawMessage);
  if (text === null) {
    send(socket, {
      type: "room.error",
      protocolVersion: PROTOCOL_VERSION,
      code: "INVALID_MESSAGE",
      message: "Unsupported WebSocket message type",
    });
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    send(socket, {
      type: "room.error",
      protocolVersion: PROTOCOL_VERSION,
      code: "INVALID_MESSAGE",
      message: "Message must be JSON",
    });
    return;
  }

  const parsed = safeParseClientMessage(data);
  if (!parsed.success) {
    send(socket, {
      type: "room.error",
      protocolVersion: PROTOCOL_VERSION,
      code: "INVALID_MESSAGE",
      message: parsed.error.issues.map((issue) => issue.message).join("; "),
    });
    return;
  }

  const message = parsed.data;
  switch (message.type) {
    case "room.join":
      handleJoin(socket, message, mediaService);
      break;
    case "room.leave": {
      const metadata = connectionMetadata.get(connectionKey(socket));
      if (
        metadata &&
        metadata.roomId === message.roomId &&
        metadata.endpointId === message.endpointId
      ) {
        handleLeave(socket, metadata, mediaService);
      }
      break;
    }
    case "policy.hostUpdate":
      send(socket, {
        type: "media.placeholder",
        protocolVersion: PROTOCOL_VERSION,
        note: "Host policy accepted",
      });
      break;
    case "telemetry.publish": {
      const metadata = connectionMetadata.get(connectionKey(socket));
      if (!metadata || metadata.roomId !== message.roomId) {
        break;
      }
      const room = rooms.get(metadata.roomId);
      const peer = room ? peerForRole(room, oppositeRole(metadata.role)) : undefined;
      if (peer) {
        send(peer.socket, {
          type: "telemetry.peerSummary",
          protocolVersion: PROTOCOL_VERSION,
          peerRole: metadata.role,
          summary: message.summary,
        });
      }
      break;
    }
    case "telemetry.clockProbe":
      send(socket, {
        type: "telemetry.clockProbeResult",
        protocolVersion: PROTOCOL_VERSION,
        probeId: message.probeId,
        clientSendTimeMs: message.clientSendTimeMs,
        serverReceiveTimeMs,
        serverSendTimeMs: Date.now(),
      });
      break;
    case "media.placeholder":
      send(socket, {
        type: "media.placeholder",
        protocolVersion: PROTOCOL_VERSION,
        note: "Media signaling and telemetry are available",
      });
      break;
    case "media.getRouterCapabilities":
    case "media.createTransport":
    case "media.connectTransport":
    case "media.produce":
    case "media.consume":
    case "media.resumeConsumer":
    case "media.closeProducer":
    case "media.getServerStats":
      await handleMediaRequest(socket, message, mediaService);
      break;
  }
}

export const app = new Hono();

app.get("/health", (context) =>
  context.json({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    runtime: "bun",
    server: "hono",
    mediasoup: mediaService ? "ready" : "initializing",
  }),
);

app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onMessage: (event, socket) => {
      void handleMessage(socket, event.data);
    },
    onClose: (_event, socket) => {
      const metadata = connectionMetadata.get(connectionKey(socket));
      if (metadata) {
        handleLeave(socket, metadata, mediaService);
      }
    },
    onError: (_event, socket) => {
      const metadata = connectionMetadata.get(connectionKey(socket));
      if (metadata) {
        handleLeave(socket, metadata, mediaService);
      }
    },
  })),
);

interface TlsFiles {
  keyPath: string;
  certPath: string;
}

function tlsFiles(): TlsFiles | null {
  const keyPath = resolve(
    process.env.TLS_KEY_PATH ??
      resolve(import.meta.dirname, "../../../infra/certs/localhost-key.pem"),
  );
  const certPath = resolve(
    process.env.TLS_CERT_PATH ??
      resolve(import.meta.dirname, "../../../infra/certs/localhost-cert.pem"),
  );
  return existsSync(keyPath) && existsSync(certPath) ? { keyPath, certPath } : null;
}

export async function startServer() {
  const hostname = process.env.HOST ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? 4443);
  const tls = tlsFiles();
  mediaService = await MediaService.create();
  const server = Bun.serve({
    hostname,
    port,
    fetch: app.fetch,
    websocket,
    ...(tls
      ? {
          tls: {
            key: Bun.file(tls.keyPath),
            cert: Bun.file(tls.certPath),
          },
        }
      : {}),
  });

  const scheme = tls ? "https" : "http";
  const wsScheme = tls ? "wss" : "ws";
  console.log(
    `[backend] Screen Share signaling and media listening on ${scheme}://${hostname}:${server.port}`,
  );
  console.log(`[backend] WebSocket path ${wsScheme}://${hostname}:${server.port}/ws`);
  console.log(`[backend] Health ${scheme}://${hostname}:${server.port}/health`);
  if (!tls) {
    console.warn(
      "[backend] TLS certs missing — generate from the workspace root with: bun run certs",
    );
  }
  return server;
}

if (import.meta.main) {
  const server = await startServer();
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`[backend] ${signal} received, closing HTTP and mediasoup`);
    await server.stop(true);
    mediaService?.close();
    mediaService = null;
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}
