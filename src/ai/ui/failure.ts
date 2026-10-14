import { t } from "../../i18n";
import type { AiError, DiagramOp } from "../index";
import type { ParsedReply } from "./reply";

export interface Failure {
  /** UI-generated failures are identified separately from the agent-facing error wording. */
  reason?: "no-change";
  error: AiError;
  /** The reply that failed, as pasted (for the fix-up prompt). */
  reply: string;
  /** The ops that failed, when the reply had ops (a candidate click patches them). */
  ops?: DiagramOp[];
  layout?: Extract<ParsedReply, { kind: "ops" }>["layout"];
  /** The reply was a simulation (the fix-up prompt asks for one again). */
  simulation?: boolean;
}

export function failureText(failure: Failure) {
  return {
    message: failure.reason === "no-change" ? t("ai.theReplyDidnTChangeAnything") : failure.error.error,
    hint: failure.reason === "no-change" ? t("ai.checkTheRequestOrAskYourAI") : failure.error.hint,
  };
}
