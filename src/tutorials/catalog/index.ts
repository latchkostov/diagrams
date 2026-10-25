import { msg } from "../../i18n";
import type { TrackId, Tutorial, Words } from "../types";
import { mobileApi } from "./mobileApi";

import { quickAdd } from "./quickAdd";
import { dotsAndSides } from "./dotsAndSides";
import { insertOnEdge } from "./insertOnEdge";
import { propertySheet } from "./propertySheet";
import { requestVsMessage } from "./requestVsMessage";
import { boundaries } from "./boundaries";
import { annotate } from "./annotate";
import { dependencies } from "./dependencies";
import { arrange } from "./arrange";
import { commandPalette } from "./commandPalette";
import { sharePresent } from "./sharePresent";

/** Every tutorial, in the order the list shows them within a track. */
export const tutorials: readonly Tutorial[] = [
  mobileApi,
  quickAdd,
  dotsAndSides,
  insertOnEdge,
  propertySheet,
  requestVsMessage,
  boundaries,
  annotate,
  dependencies,
  arrange,
  commandPalette,
  sharePresent,
];

export const tracks: readonly { id: TrackId; label: Words }[] = [
  { id: "basics", label: msg("tutorials.trackBasics") },
  { id: "blocks", label: msg("tutorials.trackBlocks") },
  { id: "simulation", label: msg("tutorials.trackSimulation") },
  { id: "waiting", label: msg("tutorials.trackWaiting") },
  { id: "resilience", label: msg("tutorials.trackResilience") },
  { id: "studies", label: msg("tutorials.trackStudies") },
];

export const findTutorial = (id: string | null): Tutorial | undefined => tutorials.find((x) => x.id === id);
export const trackLabel = (id: TrackId): string => tracks.find((x) => x.id === id)!.label();
