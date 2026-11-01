import { msg } from "../../i18n";
import type { UnavailableTutorial } from "../types";

export const workTogetherUnavailable: UnavailableTutorial = {
  id: "work-together",
  title: msg("tutorials.workTogether.title"),
  summary: msg("tutorials.workTogether.summary"),
  track: "sharing",
  optional: "collaboration",
  unavailable: msg("tutorials.sharing.unavailable"),
};

export const reviewAgentChangesUnavailable: UnavailableTutorial = {
  id: "review-agent-changes",
  title: msg("tutorials.agentReview.title"),
  summary: msg("tutorials.agentReview.summary"),
  track: "sharing",
  optional: "ai",
  unavailable: msg("tutorials.sharing.unavailable"),
};
