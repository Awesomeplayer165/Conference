export interface ClockProbeExchange {
  clientSendTimeMs: number;
  serverReceiveTimeMs: number;
  serverSendTimeMs: number;
  clientReceiveTimeMs: number;
}

export interface ClockOffsetSample {
  /** Estimated server clock minus client clock. */
  offsetMs: number;
  /** Network time with time spent inside the server removed. */
  roundTripTimeMs: number;
}

function finiteTimestamp(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function calculateClockOffset(exchange: ClockProbeExchange): ClockOffsetSample | null {
  const { clientSendTimeMs, serverReceiveTimeMs, serverSendTimeMs, clientReceiveTimeMs } = exchange;
  if (
    !finiteTimestamp(clientSendTimeMs) ||
    !finiteTimestamp(serverReceiveTimeMs) ||
    !finiteTimestamp(serverSendTimeMs) ||
    !finiteTimestamp(clientReceiveTimeMs) ||
    serverSendTimeMs < serverReceiveTimeMs ||
    clientReceiveTimeMs < clientSendTimeMs
  ) {
    return null;
  }

  const roundTripTimeMs =
    clientReceiveTimeMs - clientSendTimeMs - (serverSendTimeMs - serverReceiveTimeMs);
  if (roundTripTimeMs < 0) {
    return null;
  }
  return {
    offsetMs: (serverReceiveTimeMs - clientSendTimeMs + serverSendTimeMs - clientReceiveTimeMs) / 2,
    roundTripTimeMs,
  };
}

/**
 * Retains the lowest-RTT probe because it has the smallest queueing-error bound.
 * This estimates clock offset; it is not a glass-to-glass latency measurement.
 */
export class ClockOffsetEstimator {
  #best: ClockOffsetSample | null = null;

  get estimate(): ClockOffsetSample | null {
    return this.#best;
  }

  observe(exchange: ClockProbeExchange): ClockOffsetSample | null {
    const sample = calculateClockOffset(exchange);
    if (sample && (!this.#best || sample.roundTripTimeMs < this.#best.roundTripTimeMs)) {
      this.#best = sample;
    }
    return this.#best;
  }

  reset(): void {
    this.#best = null;
  }
}
