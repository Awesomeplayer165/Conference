import type { StatisticsSummary } from "@conference/protocol";

const SOFTWARE_ENCODERS = ["libaom", "openh264", "libvpx"];
const HARDWARE_ENCODERS = [
  "externalencoder",
  "mediafoundation",
  "nvenc",
  "nvidia",
  "qsv",
  "vaapi",
  "videotoolbox",
];

export function describeEncoderPath(summary: StatisticsSummary): string {
  const implementation = summary.encoderImplementation?.trim() ?? "";
  const normalized = implementation.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  if (SOFTWARE_ENCODERS.some((name) => normalized.includes(name))) {
    return `Software · ${implementation}`;
  }
  if (HARDWARE_ENCODERS.some((name) => normalized.includes(name))) {
    return `Hardware · ${implementation}`;
  }
  if (summary.encoderPowerEfficient === true) {
    return implementation ? `Hardware-efficient · ${implementation}` : "Hardware-efficient";
  }
  if (summary.encoderPowerEfficient === false) {
    return implementation ? `Software/unaccelerated · ${implementation}` : "Software/unaccelerated";
  }
  if (implementation && summary.encoderCapabilityPowerEfficient === true) {
    return `Hardware-efficient · ${implementation}`;
  }
  if (implementation) {
    return `Browser selected · ${implementation}`;
  }
  if (summary.encoderCapabilityPowerEfficient === true) {
    return "Hardware-capable · awaiting encoder";
  }
  return "Awaiting encoder information";
}
