import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import type { TransportListenInfo } from "mediasoup/types";

export const DEFAULT_MEDIASOUP_PORT = 40_000;
export const DEFAULT_MEDIASOUP_SOCKET_BUFFER_BYTES = 4 * 1024 * 1024;

type NetworkInterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;
type MediaEnvironment = NodeJS.ProcessEnv;

function isPrivateOrSharedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 100 && (octets[1] ?? 0) >= 64 && (octets[1] ?? 0) <= 127)
  );
}

export function defaultMediasoupListenIps(
  interfaces: NetworkInterfaceMap = networkInterfaces(),
): string[] {
  const privateAddresses = Object.entries(interfaces)
    .flatMap(([name, entries]) =>
      (entries ?? []).map((entry) => ({
        entry,
        virtual: /^(bridge|utun|awdl|llw|docker|veth|lo)/i.test(name),
      })),
    )
    .filter(
      ({ entry, virtual }) =>
        !entry.internal &&
        entry.family === "IPv4" &&
        isPrivateOrSharedIpv4(entry.address) &&
        (!virtual || entry.address.startsWith("100.")),
    )
    .map(({ entry }) => entry.address);
  return [...new Set([...privateAddresses, "127.0.0.1"])];
}

export function parseMediasoupPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_MEDIASOUP_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("MEDIASOUP_PORT must be an integer between 1024 and 65535");
  }
  return port;
}

export function parseSocketBufferBytes(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_MEDIASOUP_SOCKET_BUFFER_BYTES;
  }
  const bytes = Number(value);
  if (!Number.isInteger(bytes) || bytes < 256 * 1024 || bytes > 64 * 1024 * 1024) {
    throw new Error("MEDIASOUP_SOCKET_BUFFER_BYTES must be an integer between 262144 and 67108864");
  }
  return bytes;
}

function listenAddresses(
  environment: MediaEnvironment,
  interfaces: NetworkInterfaceMap,
): Array<{ ip: string; announcedAddress?: string }> {
  const configuredIp = environment.MEDIASOUP_LISTEN_IP;
  const announcedAddress = environment.MEDIASOUP_ANNOUNCED_ADDRESS;
  if (!configuredIp) {
    if (announcedAddress) {
      throw new Error(
        "MEDIASOUP_ANNOUNCED_ADDRESS requires MEDIASOUP_LISTEN_IP to identify its bind address",
      );
    }
    return defaultMediasoupListenIps(interfaces).map((ip) => ({ ip }));
  }
  if ((configuredIp === "0.0.0.0" || configuredIp === "::") && !announcedAddress) {
    throw new Error(
      "A wildcard MEDIASOUP_LISTEN_IP requires MEDIASOUP_ANNOUNCED_ADDRESS for usable ICE candidates",
    );
  }
  return [
    {
      ip: configuredIp,
      ...(announcedAddress ? { announcedAddress } : {}),
    },
  ];
}

export interface MediasoupWebRtcServerConfig {
  listenInfos: TransportListenInfo[];
  port: number;
}

export function mediasoupWebRtcServerConfig(
  environment: MediaEnvironment = process.env,
  interfaces: NetworkInterfaceMap = networkInterfaces(),
): MediasoupWebRtcServerConfig {
  const port = parseMediasoupPort(environment.MEDIASOUP_PORT);
  const socketBufferBytes = parseSocketBufferBytes(environment.MEDIASOUP_SOCKET_BUFFER_BYTES);
  const listenInfos = listenAddresses(environment, interfaces).flatMap((address) => [
    {
      protocol: "udp" as const,
      ...address,
      port,
      sendBufferSize: socketBufferBytes,
      recvBufferSize: socketBufferBytes,
    },
    {
      protocol: "tcp" as const,
      ...address,
      port,
      sendBufferSize: socketBufferBytes,
      recvBufferSize: socketBufferBytes,
    },
  ]);
  return { listenInfos, port };
}
