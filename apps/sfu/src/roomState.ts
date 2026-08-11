import {
  type ClientMessage,
  PROTOCOL_VERSION,
  type Role,
  type ServerMessage,
  type VideoCodec,
  type VideoCodecCapabilities,
} from "@conference/protocol";
import type { WSContext } from "hono/ws";
import type { MediaService } from "./mediaService.js";
import { selectVideoCodec } from "./videoCodecs.js";

interface PeerConnection {
  endpointId: string;
  role: Role;
  socket: WSContext;
  videoCodecs?: VideoCodecCapabilities;
}

export interface RoomState {
  id: string;
  host?: PeerConnection;
  viewer?: PeerConnection;
  producerId?: string;
}

export interface ConnectionMetadata {
  roomId: string;
  role: Role;
  endpointId: string;
}

export const rooms = new Map<string, RoomState>();
export const connectionMetadata = new WeakMap<object, ConnectionMetadata>();

export function connectionKey(socket: WSContext): object {
  const raw = socket.raw;
  return raw !== null && (typeof raw === "object" || typeof raw === "function")
    ? (raw as object)
    : socket;
}

export function send(socket: WSContext, message: ServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

export function peerForRole(room: RoomState, role: Role): PeerConnection | undefined {
  return role === "host" ? room.host : room.viewer;
}

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId };
    rooms.set(roomId, room);
  }
  return room;
}

function setPeer(room: RoomState, peer: PeerConnection): void {
  if (peer.role === "host") {
    room.host = peer;
  } else {
    room.viewer = peer;
  }
}

function clearPeer(room: RoomState, role: Role): void {
  if (role === "host") {
    delete room.host;
  } else {
    delete room.viewer;
  }
  if (!room.host && !room.viewer) {
    rooms.delete(room.id);
  }
}

export function oppositeRole(role: Role): Role {
  return role === "host" ? "viewer" : "host";
}

function selectedVideoCodec(room: RoomState): VideoCodec | null {
  if (!room.host || !room.viewer) {
    return null;
  }
  return selectVideoCodec(room.host.videoCodecs, room.viewer.videoCodecs);
}

export function handleJoin(
  socket: WSContext,
  message: Extract<ClientMessage, { type: "room.join" }>,
  mediaService: MediaService | null,
): void {
  const previous = connectionMetadata.get(connectionKey(socket));
  if (previous) {
    handleLeave(socket, previous, mediaService);
  }

  const room = getOrCreateRoom(message.roomId);
  const existing = peerForRole(room, message.role);
  if (existing && existing.socket !== socket) {
    send(socket, {
      type: "room.error",
      protocolVersion: PROTOCOL_VERSION,
      code: "ROLE_TAKEN",
      message: `Role ${message.role} is already taken in room ${message.roomId}`,
    });
    return;
  }

  const peer: PeerConnection = {
    endpointId: message.endpointId,
    role: message.role,
    socket,
    ...(message.videoCodecs ? { videoCodecs: message.videoCodecs } : {}),
  };
  const metadata: ConnectionMetadata = {
    roomId: room.id,
    role: message.role,
    endpointId: message.endpointId,
  };
  setPeer(room, peer);
  connectionMetadata.set(connectionKey(socket), metadata);

  const other = peerForRole(room, oppositeRole(message.role));
  const codec = selectedVideoCodec(room);
  send(socket, {
    type: "room.joined",
    protocolVersion: PROTOCOL_VERSION,
    roomId: room.id,
    role: message.role,
    endpointId: message.endpointId,
    peerPresent: Boolean(other),
    selectedVideoCodec: codec,
  });

  if (other) {
    send(other.socket, {
      type: "room.peerUpdate",
      protocolVersion: PROTOCOL_VERSION,
      roomId: room.id,
      peerRole: message.role,
      present: true,
      selectedVideoCodec: codec,
    });
  }
  if (message.role === "viewer" && room.producerId) {
    send(socket, {
      type: "media.producerAvailable",
      protocolVersion: PROTOCOL_VERSION,
      producerId: room.producerId,
    });
  }
}

export function handleLeave(
  socket: WSContext,
  metadata: ConnectionMetadata,
  mediaService: MediaService | null,
): void {
  const room = rooms.get(metadata.roomId);
  connectionMetadata.delete(connectionKey(socket));
  mediaService?.closeEndpoint(metadata.endpointId);
  if (!room) {
    return;
  }
  const peer = peerForRole(room, metadata.role);
  if (!peer || peer.endpointId !== metadata.endpointId || peer.socket !== socket) {
    return;
  }

  const closedProducerId = metadata.role === "host" ? room.producerId : undefined;
  if (metadata.role === "host") {
    delete room.producerId;
  }
  clearPeer(room, metadata.role);
  const other = peerForRole(room, oppositeRole(metadata.role));
  if (other) {
    send(other.socket, {
      type: "room.peerUpdate",
      protocolVersion: PROTOCOL_VERSION,
      roomId: metadata.roomId,
      peerRole: metadata.role,
      present: false,
      selectedVideoCodec: null,
    });
    if (closedProducerId) {
      send(other.socket, {
        type: "media.producerClosed",
        protocolVersion: PROTOCOL_VERSION,
        producerId: closedProducerId,
      });
    }
  }
}
