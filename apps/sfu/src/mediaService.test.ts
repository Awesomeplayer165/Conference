import { describe, expect, it } from "bun:test";
import {
  defaultMediasoupListenIps,
  mediasoupWebRtcServerConfig,
  parseMediasoupPort,
  parseSocketBufferBytes,
} from "./mediaConfig.js";
import { fractionLostToPercent, MediaService } from "./mediaService.js";

describe("mediasoup statistics normalization", () => {
  it("converts the RTCP 8-bit loss fraction without treating one as 100 percent", () => {
    expect(fractionLostToPercent(null)).toBeNull();
    expect(fractionLostToPercent(0)).toBe(0);
    expect(fractionLostToPercent(1)).toBeCloseTo(0.390625);
    expect(fractionLostToPercent(256)).toBe(100);
  });
});

describe("mediasoup ICE listen addresses", () => {
  it("advertises private and shared address-space candidates before loopback", () => {
    expect(
      defaultMediasoupListenIps({
        en0: [
          {
            address: "192.168.4.210",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "00:00:00:00:00:01",
            internal: false,
            cidr: "192.168.4.210/24",
          },
        ],
        bridge0: [
          {
            address: "10.0.0.5",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "00:00:00:00:00:02",
            internal: false,
            cidr: "10.0.0.5/24",
          },
        ],
        utun0: [
          {
            address: "100.64.0.8",
            netmask: "255.192.0.0",
            family: "IPv4",
            mac: "00:00:00:00:00:03",
            internal: false,
            cidr: "100.64.0.8/10",
          },
        ],
      }),
    ).toEqual(["192.168.4.210", "100.64.0.8", "127.0.0.1"]);
  });

  it("validates the shared media port", () => {
    expect(parseMediasoupPort(undefined)).toBe(40_000);
    expect(parseMediasoupPort("50000")).toBe(50_000);
    expect(() => parseMediasoupPort("50000-50100")).toThrow();
    expect(() => parseMediasoupPort("80")).toThrow();
    expect(parseSocketBufferBytes(undefined)).toBe(4 * 1024 * 1024);
    expect(() => parseSocketBufferBytes("1024")).toThrow();
  });

  it("uses one shared UDP/TCP port and the configured announced address", () => {
    const configuration = mediasoupWebRtcServerConfig(
      {
        MEDIASOUP_LISTEN_IP: "0.0.0.0",
        MEDIASOUP_ANNOUNCED_ADDRESS: "100.64.0.6",
        MEDIASOUP_PORT: "50000",
      },
      {},
    );
    expect(configuration.port).toBe(50_000);
    expect(configuration.listenInfos).toEqual([
      {
        protocol: "udp",
        ip: "0.0.0.0",
        announcedAddress: "100.64.0.6",
        port: 50_000,
        sendBufferSize: 4 * 1024 * 1024,
        recvBufferSize: 4 * 1024 * 1024,
      },
      {
        protocol: "tcp",
        ip: "0.0.0.0",
        announcedAddress: "100.64.0.6",
        port: 50_000,
        sendBufferSize: 4 * 1024 * 1024,
        recvBufferSize: 4 * 1024 * 1024,
      },
    ]);
  });
});

describe("mediasoup Stage 3 runtime", () => {
  it("starts the worker and creates a UDP/TCP transport", async () => {
    const previousListenIp = process.env.MEDIASOUP_LISTEN_IP;
    const previousAnnouncedAddress = process.env.MEDIASOUP_ANNOUNCED_ADDRESS;
    const previousPort = process.env.MEDIASOUP_PORT;
    process.env.MEDIASOUP_LISTEN_IP = "127.0.0.1";
    process.env.MEDIASOUP_PORT = "45679";
    delete process.env.MEDIASOUP_ANNOUNCED_ADDRESS;
    const media = await MediaService.create();
    try {
      expect(media.routerRtpCapabilities.codecs?.map((codec) => codec.mimeType)).toContain(
        "video/H264",
      );
      expect(media.routerRtpCapabilities.codecs?.map((codec) => codec.mimeType)).toContain(
        "video/AV1",
      );
      expect(media.routerRtpCapabilities.codecs?.map((codec) => codec.mimeType)).not.toContain(
        "video/H265",
      );
      expect(media.routerRtpCapabilities.codecs?.map((codec) => codec.mimeType)).toContain(
        "video/rtx",
      );

      const transport = await media.createTransport("endpoint-1", "send");
      const secondTransport = await media.createTransport("endpoint-2", "recv");
      expect(transport.iceCandidates.map((candidate) => candidate.protocol)).toContain("udp");
      expect(transport.iceCandidates.map((candidate) => candidate.protocol)).toContain("tcp");
      expect(transport.dtlsParameters.fingerprints.length).toBeGreaterThan(0);
      expect(secondTransport.iceCandidates.map((candidate) => candidate.port)).toEqual(
        transport.iceCandidates.map((candidate) => candidate.port),
      );
      expect(new Set(transport.iceCandidates.map((candidate) => candidate.port))).toEqual(
        new Set([45_679]),
      );
    } finally {
      media.close();
      if (previousListenIp === undefined) {
        delete process.env.MEDIASOUP_LISTEN_IP;
      } else {
        process.env.MEDIASOUP_LISTEN_IP = previousListenIp;
      }
      if (previousAnnouncedAddress === undefined) {
        delete process.env.MEDIASOUP_ANNOUNCED_ADDRESS;
      } else {
        process.env.MEDIASOUP_ANNOUNCED_ADDRESS = previousAnnouncedAddress;
      }
      if (previousPort === undefined) {
        delete process.env.MEDIASOUP_PORT;
      } else {
        process.env.MEDIASOUP_PORT = previousPort;
      }
      await Bun.sleep(100);
    }
  });
});
