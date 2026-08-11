import { describe, expect, it } from "bun:test";
import {
  defaultMediasoupListenIps,
  fractionLostToPercent,
  MediaService,
  parseMediasoupPortRange,
} from "./mediaService.js";

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

  it("validates an optional container-friendly media port range", () => {
    expect(parseMediasoupPortRange(undefined, undefined)).toBeUndefined();
    expect(parseMediasoupPortRange("40000", "40100")).toEqual({ min: 40_000, max: 40_100 });
    expect(() => parseMediasoupPortRange("40100", "40000")).toThrow();
  });
});

describe("mediasoup Stage 3 runtime", () => {
  it("starts the worker and creates a UDP/TCP transport", async () => {
    const previousListenIp = process.env.MEDIASOUP_LISTEN_IP;
    const previousAnnouncedAddress = process.env.MEDIASOUP_ANNOUNCED_ADDRESS;
    process.env.MEDIASOUP_LISTEN_IP = "127.0.0.1";
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
      expect(transport.iceCandidates.map((candidate) => candidate.protocol)).toContain("udp");
      expect(transport.iceCandidates.map((candidate) => candidate.protocol)).toContain("tcp");
      expect(transport.dtlsParameters.fingerprints.length).toBeGreaterThan(0);
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
      await Bun.sleep(100);
    }
  });
});
