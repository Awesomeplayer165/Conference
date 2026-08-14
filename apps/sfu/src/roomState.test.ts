import { afterEach, describe, expect, it } from "bun:test";
import { PROTOCOL_VERSION, type ServerMessage } from "@conference/protocol";
import type { WSContext } from "hono/ws";
import type { MediaService } from "./mediaService.js";
import { connectionKey, connectionMetadata, handleJoin, handleLeave, rooms } from "./roomState.js";

function socketCollector() {
  const messages: ServerMessage[] = [];
  const socket = {
    raw: {},
    readyState: 1,
    send(value: string) {
      messages.push(JSON.parse(value) as ServerMessage);
    },
  } as unknown as WSContext;
  return { messages, socket };
}

function join(socket: WSContext, endpointId: string, role: "host" | "viewer") {
  handleJoin(
    socket,
    {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "room-reuse",
      endpointId,
      role,
      videoCodecs: {
        send: ["video/AV1", "video/H264"],
        receive: ["video/AV1", "video/H264"],
      },
    },
    null,
  );
}

afterEach(() => rooms.clear());

describe("room role lifecycle", () => {
  it("lets a replacement viewer fill the role after the first viewer leaves", () => {
    const host = socketCollector();
    const firstViewer = socketCollector();
    const replacementViewer = socketCollector();
    join(host.socket, "host-1", "host");
    join(firstViewer.socket, "viewer-1", "viewer");

    const metadata = connectionMetadata.get(connectionKey(firstViewer.socket));
    expect(metadata).toBeDefined();
    if (!metadata) {
      throw new Error("viewer metadata was not stored");
    }
    handleLeave(firstViewer.socket, metadata, null);
    join(replacementViewer.socket, "viewer-2", "viewer");

    expect(rooms.get("room-reuse")?.viewer?.endpointId).toBe("viewer-2");
    expect(replacementViewer.messages.at(-1)).toMatchObject({
      type: "room.joined",
      peerPresent: true,
      selectedVideoCodec: "video/AV1",
    });
  });

  it("closes host media and lets a replacement host reuse the role", () => {
    const host = socketCollector();
    const viewer = socketCollector();
    const replacementHost = socketCollector();
    const closedEndpoints: string[] = [];
    const media = {
      closeEndpoint(endpointId: string) {
        closedEndpoints.push(endpointId);
      },
    } as unknown as MediaService;
    join(host.socket, "host-1", "host");
    join(viewer.socket, "viewer-1", "viewer");

    const room = rooms.get("room-reuse");
    if (room) {
      room.producerId = "producer-1";
      room.audioProducerId = "audio-producer-1";
      room.producerCodec = "video/AV1";
    }
    const metadata = connectionMetadata.get(connectionKey(host.socket));
    expect(metadata).toBeDefined();
    if (!metadata) {
      throw new Error("host metadata was not stored");
    }
    handleLeave(host.socket, metadata, media);
    join(replacementHost.socket, "host-2", "host");

    expect(closedEndpoints).toEqual(["host-1"]);
    expect(rooms.get("room-reuse")?.host?.endpointId).toBe("host-2");
    expect(rooms.get("room-reuse")?.producerId).toBeUndefined();
    expect(rooms.get("room-reuse")?.audioProducerId).toBeUndefined();
    expect(replacementHost.messages.at(-1)).toMatchObject({
      type: "room.joined",
      peerPresent: true,
      selectedVideoCodec: "video/AV1",
    });
  });

  it("announces both existing video and display audio to a replacement viewer", () => {
    const host = socketCollector();
    const viewer = socketCollector();
    join(host.socket, "host-1", "host");
    const room = rooms.get("room-reuse");
    if (!room) throw new Error("room was not created");
    room.producerId = "video-1";
    room.audioProducerId = "audio-1";
    room.producerCodec = "video/AV1";

    join(viewer.socket, "viewer-1", "viewer");

    expect(viewer.messages).toContainEqual(
      expect.objectContaining({
        type: "media.producerAvailable",
        producerId: "video-1",
        kind: "video",
      }),
    );
    expect(viewer.messages).toContainEqual(
      expect.objectContaining({
        type: "media.producerAvailable",
        producerId: "audio-1",
        kind: "audio",
      }),
    );
  });
});
