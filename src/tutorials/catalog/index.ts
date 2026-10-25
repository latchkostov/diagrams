import { whereTimeGoes } from "./whereTimeGoes";
import { threadsBlock } from "./threadsBlock";
import { timeoutsPools } from "./timeoutsPools";
import { backlogLag } from "./backlogLag";
import { autoscaling } from "./autoscaling";
import { scaleToZero } from "./scaleToZero";
import { ratesAndInputs } from "./ratesAndInputs";
import { readANode } from "./readANode";
import { capacity } from "./capacity";
import { traceSlowmo } from "./traceSlowmo";
import { savedSimulations } from "./savedSimulations";
import { faults } from "./faults";
import { authorADrill } from "./authorADrill";
import { loadShedding } from "./loadShedding";
import { deadLetters } from "./deadLetters";
import { healthChecks } from "./healthChecks";
import { msg } from "../../i18n";
import type { TrackId, Tutorial, Words } from "../types";
import { apiGateway } from "./apiGateway";
import { kafkaTopic } from "./kafkaTopic";
import { queueWorkers } from "./queueWorkers";
import { loadBalancer } from "./loadBalancer";
import { cacheAside } from "./cacheAside";
import { mobileApi } from "./mobileApi";
import { webhooks } from "./webhooks";
import { fanout } from "./fanout";
import { partitions } from "./partitions";
import { outbox } from "./outbox";
import { dependencies2 } from "./dependencies2";
import { retryStorm } from "./retryStorm";
import { backoffBudget } from "./backoffBudget";
import { circuitBreaker } from "./circuitBreaker";
import { rateLimit } from "./rateLimit";
import { studyCheckout } from "./studyCheckout";
import { studyDispatch } from "./studyDispatch";
import { studyPayments } from "./studyPayments";
import { sharedApiQuotas } from "./sharedApiQuotas";
import { studyFanout } from "./studyFanout";
import { studyRag } from "./studyRag";
import { studyCells } from "./studyCells";

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
export const allTutorials: readonly Tutorial[] = [
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
  apiGateway,
  kafkaTopic,
  queueWorkers,
  loadBalancer,
  cacheAside,
  webhooks,
  fanout,
  partitions,
  outbox,
  dependencies2,
  whereTimeGoes,
  threadsBlock,
  timeoutsPools,
  backlogLag,
  autoscaling,
  scaleToZero,
  ratesAndInputs,
  readANode,
  capacity,
  traceSlowmo,
  savedSimulations,
  faults,
  authorADrill,
  retryStorm,
  backoffBudget,
  circuitBreaker,
  rateLimit,
  sharedApiQuotas,
  loadShedding,
  deadLetters,
  healthChecks,
  studyCheckout,
  studyDispatch,
  studyPayments,
  studyFanout,
  studyRag,
  studyCells,
];

/** Available lessons only: discovery, deep links and progress totals share this catalog. */
export const tutorials = allTutorials.filter((t) => !t.quarantined);

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
