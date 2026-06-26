import type { ExportPreset, StationSpec } from "../types/models";

const unknownSpec = {
  acceptedFormats: ["WAV", "MP3 reference"],
  sampleRate: "Unknown, confirm with station",
  bitDepth: "Unknown, confirm with station",
  channels: "Unknown, confirm with station",
  loudnessTarget: "Placeholder, producer must verify",
  truePeakCeiling: "Placeholder, producer must verify",
  namingConvention: "{brand}_{campaign}_{duration}_{date}",
  deliveryEmail: "Confirm before dispatch",
  deliveryPlatform: "Confirm before dispatch",
  notes: "Station-specific delivery requirements are not verified in this MVP.",
  lastVerified: "Unverified",
  sourceUrl: "",
  confidenceLevel: "unknown" as const,
};

const stationNames = [
  ["rte-radio-1", "RTE Radio 1", "RTE"],
  ["rte-2fm", "RTE 2FM", "RTE"],
  ["today-fm", "Today FM", "Bauer Media Audio Ireland"],
  ["newstalk", "Newstalk", "Bauer Media Audio Ireland"],
  ["fm104", "FM104", "Wireless Ireland"],
  ["98fm", "98FM", "Bauer Media Audio Ireland"],
  ["spin", "Spin", "Bauer Media Audio Ireland"],
  ["iradio", "iRadio", "iRadio"],
  ["galway-bay-fm", "Galway Bay FM", "Independent"],
  ["corks-red-fm", "Cork's Red FM", "Wireless Ireland"],
  ["beat", "Beat", "Bauer Media Audio Ireland"],
  ["midlands-103", "Midlands 103", "Independent"],
  ["highland-radio", "Highland Radio", "Independent"],
  ["lmfm", "LMFM", "Wireless Ireland"],
  ["sunshine", "Sunshine", "Independent"],
  ["classic-hits", "Classic Hits", "Bay Broadcasting"],
  ["q102", "Q102", "Wireless Ireland"],
  ["custom", "Other / custom", "Custom"],
];

export const stationSpecs: StationSpec[] = stationNames.map(([id, name, group]) => ({
  id,
  name,
  group,
  maxDuration: id === "custom" ? 120 : 60,
  ...unknownSpec,
}));

export const exportPresets: ExportPreset[] = [
  {
    id: "irish-radio-generic",
    name: "Irish radio package",
    description:
      "Generic Irish radio handoff package with WAV target, MP3 reference, cue sheets, QC, and unverified station-spec flags.",
    formats: ["WAV final placeholder", "MP3 reference placeholder", "Markdown sheets", "Project JSON"],
    metadataFields: ["client", "brand", "campaign", "duration", "version", "approval status", "station"],
    requiresQcPass: true,
    requiresHumanApproval: true,
    stationSpecIds: stationSpecs.map((station) => station.id),
  },
];
