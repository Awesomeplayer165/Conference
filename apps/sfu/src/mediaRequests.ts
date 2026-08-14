import { type MediaRequestMessage, PROTOCOL_VERSION } from "@conference/protocol";
import type { WSContext } from "hono/ws";
import type { DtlsParameters, RtpCapabilities, RtpParameters } from "mediasoup/types";
import type { MediaService } from "./mediaService.js";
import { connectionKey, connectionMetadata, rooms, send } from "./roomState.js";
import { routedVideoCodec } from "./videoCodecs.js";

function mediaError(
  socket: WSContext,
  requestId: string,
  code:
    | "MEDIA_NOT_READY"
    | "NOT_JOINED"
    | "NOT_AUTHORIZED"
    | "NOT_FOUND"
    | "CANNOT_CONSUME"
    | "MEDIA_OPERATION_FAILED",
  message: string,
): void {
  send(socket, {
    type: "media.error",
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    code,
    message,
  });
}

export async function handleMediaRequest(
  socket: WSContext,
  message: MediaRequestMessage,
  media: MediaService | null,
): Promise<void> {
  const metadata = connectionMetadata.get(connectionKey(socket));
  if (!metadata) {
    mediaError(socket, message.requestId, "NOT_JOINED", "Join a room first");
    return;
  }
  if (!media) {
    mediaError(socket, message.requestId, "MEDIA_NOT_READY", "mediasoup is not ready");
    return;
  }
  const room = rooms.get(metadata.roomId);
  if (!room) {
    mediaError(socket, message.requestId, "NOT_FOUND", "Room not found");
    return;
  }

  try {
    switch (message.type) {
      case "media.getRouterCapabilities":
        send(socket, {
          type: "media.routerCapabilities",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
          rtpCapabilities: media.routerRtpCapabilities as unknown as Record<string, unknown>,
        });
        break;
      case "media.createTransport": {
        const allowed =
          (metadata.role === "host" && message.direction === "send") ||
          (metadata.role === "viewer" && message.direction === "recv");
        if (!allowed) {
          mediaError(
            socket,
            message.requestId,
            "NOT_AUTHORIZED",
            `Role ${metadata.role} cannot create a ${message.direction} transport`,
          );
          return;
        }
        const transport = await media.createTransport(metadata.endpointId, message.direction);
        send(socket, {
          type: "media.transportCreated",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
          transport: transport as unknown as {
            id: string;
            iceParameters: Record<string, unknown>;
            iceCandidates: Record<string, unknown>[];
            dtlsParameters: Record<string, unknown>;
            sctpParameters: Record<string, unknown> | null;
          },
        });
        break;
      }
      case "media.connectTransport":
        await media.connectTransport(
          metadata.endpointId,
          message.transportId,
          message.dtlsParameters as unknown as DtlsParameters,
        );
        send(socket, {
          type: "media.ack",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
        });
        break;
      case "media.produce": {
        if (metadata.role !== "host") {
          mediaError(
            socket,
            message.requestId,
            "NOT_AUTHORIZED",
            "Only the host can produce screen video",
          );
          return;
        }
        const replacedProducerId = room.producerId;
        const producer = await media.produce(
          metadata.endpointId,
          message.transportId,
          message.rtpParameters as unknown as RtpParameters,
        );
        room.producerId = producer.id;
        const producerCodec = routedVideoCodec(
          producer.rtpParameters.codecs.find(
            (codec) => !codec.mimeType.toLowerCase().endsWith("/rtx"),
          )?.mimeType,
        );
        if (producerCodec) {
          room.producerCodec = producerCodec;
        } else {
          delete room.producerCodec;
        }
        if (message.hdrMetadata) {
          room.producerHdrMetadata = message.hdrMetadata;
        } else {
          delete room.producerHdrMetadata;
        }
        if (replacedProducerId && replacedProducerId !== producer.id) {
          media.closeProducer(metadata.endpointId, replacedProducerId);
        }
        producer.observer.once("close", () => {
          if (room.producerId !== producer.id) {
            return;
          }
          delete room.producerId;
          delete room.producerCodec;
          delete room.producerHdrMetadata;
          if (room.viewer) {
            send(room.viewer.socket, {
              type: "media.producerClosed",
              protocolVersion: PROTOCOL_VERSION,
              producerId: producer.id,
            });
          }
        });
        send(socket, {
          type: "media.produced",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
          producerId: producer.id,
        });
        if (room.viewer) {
          send(room.viewer.socket, {
            type: "media.producerAvailable",
            protocolVersion: PROTOCOL_VERSION,
            producerId: producer.id,
            ...(producerCodec ? { codec: producerCodec } : {}),
            ...(message.hdrMetadata ? { hdrMetadata: message.hdrMetadata } : {}),
          });
        }
        break;
      }
      case "media.consume": {
        if (metadata.role !== "viewer" || room.producerId !== message.producerId) {
          mediaError(
            socket,
            message.requestId,
            "NOT_AUTHORIZED",
            "The requested producer is not available in this room",
          );
          return;
        }
        const consumer = await media.consume(
          metadata.endpointId,
          message.transportId,
          message.producerId,
          message.rtpCapabilities as unknown as RtpCapabilities,
        );
        send(socket, {
          type: "media.consumerCreated",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
          consumer: consumer as unknown as {
            id: string;
            producerId: string;
            kind: "video";
            rtpParameters: Record<string, unknown>;
          },
        });
        break;
      }
      case "media.resumeConsumer":
        await media.resumeConsumer(metadata.endpointId, message.consumerId);
        send(socket, {
          type: "media.ack",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
        });
        break;
      case "media.closeProducer":
        if (metadata.role !== "host") {
          mediaError(
            socket,
            message.requestId,
            "NOT_AUTHORIZED",
            "Only the host can close its producer",
          );
          return;
        }
        media.closeProducer(metadata.endpointId, message.producerId);
        send(socket, {
          type: "media.ack",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
        });
        break;
      case "media.getServerStats": {
        const stats = await media.getEndpointStats(metadata.endpointId);
        send(socket, {
          type: "media.serverStats",
          protocolVersion: PROTOCOL_VERSION,
          requestId: message.requestId,
          stats,
        });
        break;
      }
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown media error";
    console.error(
      `[sfu] ${message.type} failed for ${metadata.role} endpoint ${metadata.endpointId}: ${messageText}`,
      error,
    );
    mediaError(
      socket,
      message.requestId,
      messageText === "CANNOT_CONSUME"
        ? "CANNOT_CONSUME"
        : messageText.includes("not found") || messageText.includes("not available")
          ? "NOT_FOUND"
          : "MEDIA_OPERATION_FAILED",
      messageText,
    );
  }
}
