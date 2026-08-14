import type { VideoCodec } from "@conference/protocol";
import type { DisplayCaptureSession } from "../capture/index.js";
import type { MediasoupSession, ProducerSettings } from "./MediasoupSession.js";

interface HostCodecSwitchInput {
  capture: DisplayCaptureSession | null;
  currentProducerId: string;
  requestedCodec: VideoCodec;
  session: MediasoupSession | null;
  settings: ProducerSettings | null;
}

export async function switchHostProducerCodec(
  input: HostCodecSwitchInput,
): Promise<ProducerSettings | null> {
  if (
    !input.session?.producer ||
    input.session.producer.id !== input.currentProducerId ||
    !input.capture ||
    !input.settings
  ) {
    return null;
  }
  const nextSettings: ProducerSettings = {
    ...input.settings,
  };
  await input.session.startProducing(input.capture.track, nextSettings, input.requestedCodec);
  return nextSettings;
}
