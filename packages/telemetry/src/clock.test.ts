import { describe, expect, it } from "bun:test";
import { ClockOffsetEstimator, calculateClockOffset } from "./clock.js";

describe("clock offset estimation", () => {
  it("removes server processing time from the NTP-style exchange", () => {
    expect(
      calculateClockOffset({
        clientSendTimeMs: 1_000,
        serverReceiveTimeMs: 1_030,
        serverSendTimeMs: 1_040,
        clientReceiveTimeMs: 1_060,
      }),
    ).toEqual({ offsetMs: 5, roundTripTimeMs: 50 });
  });

  it("retains the least queue-inflated probe", () => {
    const estimator = new ClockOffsetEstimator();
    estimator.observe({
      clientSendTimeMs: 1_000,
      serverReceiveTimeMs: 1_100,
      serverSendTimeMs: 1_100,
      clientReceiveTimeMs: 1_200,
    });
    expect(
      estimator.observe({
        clientSendTimeMs: 2_000,
        serverReceiveTimeMs: 2_025,
        serverSendTimeMs: 2_025,
        clientReceiveTimeMs: 2_050,
      }),
    ).toEqual({ offsetMs: 0, roundTripTimeMs: 50 });
  });

  it("rejects impossible timestamp ordering", () => {
    expect(
      calculateClockOffset({
        clientSendTimeMs: 2_000,
        serverReceiveTimeMs: 2_010,
        serverSendTimeMs: 2_005,
        clientReceiveTimeMs: 2_020,
      }),
    ).toBeNull();
  });
});
