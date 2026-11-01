import { AI_TOOLS } from "../../lib/deployment";
import { ROOMS } from "../../lib/localOnly";
import { exportForAudience } from "./exportForAudience";
import { workTogether } from "./workTogether";
import { reviewAgentChanges } from "./reviewAgentChanges";
import { scaleOnBacklog } from "./scaleOnBacklog";
import { withCoachRoutes } from "../coachRoutes";
import { authorASimulation } from "./authorASimulation";
import { sequenceEvidence } from "./sequenceEvidence";
import { resourceHeadroom } from "./resourceHeadroom";
import { importAndReview } from "./importAndReview";
import { libraryReuse } from "./libraryReuse";
import { workbenchTour } from "./workbenchTour";
import { routeByAddress } from "./routeByAddress";
import { networkPolicy } from "./networkPolicy";
import { checksAndFixes } from "./checksAndFixes";
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
import type { TrackId, Tutorial, TutorialEntry } from "../types";
import { workTogetherUnavailable, reviewAgentChangesUnavailable } from "./unavailable";
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
import { withKeyboardSolutions } from "../keyboard";

/** Every tutorial, in the order the list shows them within a track. */
export const allTutorials: readonly Tutorial[] = [
  workbenchTour,
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
  libraryReuse,
  importAndReview,
  apiGateway,
  routeByAddress,
  kafkaTopic,
  queueWorkers,
  loadBalancer,
  cacheAside,
  webhooks,
  fanout,
  partitions,
  outbox,
  dependencies2,
  networkPolicy,
  checksAndFixes,
  whereTimeGoes,
  threadsBlock,
  timeoutsPools,
  backlogLag,
  autoscaling,
  scaleOnBacklog,
  scaleToZero,
  ratesAndInputs,
  readANode,
  capacity,
  resourceHeadroom,
  traceSlowmo,
  sequenceEvidence,
  savedSimulations,
  authorASimulation,
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
  sharePresent,
  exportForAudience,
  ...(ROOMS ? [workTogether] : []),
  ...(AI_TOOLS ? [reviewAgentChanges] : []),
]
  .map(withKeyboardSolutions)
  .map(withCoachRoutes);

/** Runnable lessons only: progress and handoffs never start an unavailable extension. */
export const tutorials = allTutorials.filter((t) => !t.quarantined);

/** Discovery and deep links retain optional lesson identities when their code is compiled out. */
export const tutorialCatalog: readonly TutorialEntry[] = tutorialEntries.flatMap<TutorialEntry>((entry) => {
  const lesson = tutorials.find((lesson) => lesson.id === entry.id);
  if (lesson) return [lesson];
  if (entry.id === "work-together" && !ROOMS) return [workTogetherUnavailable];
  if (entry.id === "review-agent-changes" && !AI_TOOLS) return [reviewAgentChangesUnavailable];
  return [];
});

export { tracks } from "../chapters";
import { chapters } from "../chapters";
import { tutorialEntries } from "./ids";

export const findTutorial = (id: string | null): TutorialEntry | undefined => tutorialCatalog.find((x) => x.id === id);
export const trackLabel = (id: TrackId): string => chapters[id].label();
