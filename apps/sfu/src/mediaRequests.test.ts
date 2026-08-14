import { afterEach, describe, expect, it } from "bun:test";
import { PROTOCOL_VERSION, type ServerMessage } from "@conference/protocol";
import type { WSContext } from "hono/ws";
import { handleMediaRequest } from "./mediaRequests.js";
import type { MediaService } from "./mediaService.js";
import { connectionKey, connectionMetadata, rooms } from "./roomState.js";

function socketCollector() {
  const messages: ServerMessage[] = [];
  const raw = {};
  const socket = {
    raw,
    readyState: 1,
    send(value: string) {
      messages.push(JSON.parse(value) as ServerMessage);
    },
  } as unknown as WSContext;
  return { messages, socket };
}

afterEach(() => rooms.clear());

describe("receiver recovery signaling", () => {
  it("forwards one compatible codec fallback request to the host", async () => {
    const host = socketCollector();
    const viewer = socketCollector();
    rooms.set("room-1", {
      id: "room-1",
      producerId: "producer-1",
      producerCodec: "video/AV1",
      host: {
        endpointId: "host-1",
        role: "host",
        socket: host.socket,
        videoCodecs: { send: ["video/AV1", "video/H264"], receive: ["video/H264"] },
      },
      viewer: {
        endpointId: "viewer-1",
        role: "viewer",
        socket: viewer.socket,
        videoCodecs: { send: ["video/H264"], receive: ["video/AV1", "video/H264"] },
      },
    });
    connectionMetadata.set(connectionKey(viewer.socket), {
      roomId: "room-1",
      role: "viewer",
      endpointId: "viewer-1",
    });
    const media = {
      consumerProducerId: () => "producer-1",
    } as unknown as MediaService;
    const request = {
      type: "media.requestCodecFallback" as const,
      protocolVersion: PROTOCOL_VERSION,
      requestId: "fallback-1",
      consumerId: "consumer-1",
      requestedCodec: "video/H264" as const,
    };

    await handleMediaRequest(viewer.socket, request, media);
    await handleMediaRequest(viewer.socket, { ...request, requestId: "fallback-2" }, media);

    expect(host.messages).toEqual([
      {
        type: "media.codecSwitchRequested",
        protocolVersion: PROTOCOL_VERSION,
        producerId: "producer-1",
        requestedCodec: "video/H264",
        reason: "decode-failure",
      },
    ]);
    expect(viewer.messages.map((message) => message.type)).toEqual(["media.ack", "media.ack"]);
  });

  it("requests a keyframe on the existing consumer", async () => {
    const viewer = socketCollector();
    rooms.set("room-2", { id: "room-2" });
    connectionMetadata.set(connectionKey(viewer.socket), {
      roomId: "room-2",
      role: "viewer",
      endpointId: "viewer-2",
    });
    const requested: string[] = [];
    const media = {
      requestConsumerKeyFrame: (_endpointId: string, consumerId: string) => {
        requested.push(consumerId);
        return Promise.resolve();
      },
    } as unknown as MediaService;

    await handleMediaRequest(
      viewer.socket,
      {
        type: "media.requestConsumerKeyFrame",
        protocolVersion: PROTOCOL_VERSION,
        requestId: "keyframe-1",
        consumerId: "consumer-2",
      },
      media,
    );

    expect(requested).toEqual(["consumer-2"]);
    expect(viewer.messages[0]?.type).toBe("media.ack");
  });
});
