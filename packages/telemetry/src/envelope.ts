import {
  type BrowserInfo,
  PROTOCOL_VERSION,
  type Role,
  type TelemetryEnvelope,
  TelemetryEnvelopeSchema,
} from "@conference/protocol";

type TelemetryValue = string | number | boolean | null;

export interface CreateEnvelopeArgs {
  sessionId: string;
  endpointId: string;
  role: Role;
  monotonicTime: number;
  sequence: number;
  kind: "sample" | "event";
  payload: Record<string, TelemetryValue>;
  browser?: BrowserInfo;
  presence?: Record<string, boolean>;
  wallTime?: string;
}

export function createTelemetryEnvelope(args: CreateEnvelopeArgs): TelemetryEnvelope {
  return TelemetryEnvelopeSchema.parse({
    schemaVersion: PROTOCOL_VERSION,
    wallTime: args.wallTime ?? new Date().toISOString(),
    ...args,
  });
}
