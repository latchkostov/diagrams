import { checkAutoscaling } from "./autoscalingSchema";
import { resourceBudgetExceeded, MAX_LIFECYCLE_REPLICAS, type ResourceCandidate } from "./resourceBudget";
import { t } from "../i18n/core";
import { bindingValidator } from "./kedaBindings";
import type { AutoscalingConfig } from "./autoscaling";

/** Persisted-resource rules shared by native reads and editor transactions. Cache only immutable editor inputs. */
export function createResourceValidator({ fragment = false } = {}) {
  let previous = new Map<string, { resources: unknown; autoscaling: unknown; replicas: unknown }>();
  let simulations: ResourceCandidate["simulations"];
  let revision: string | undefined;
  let initialized = false;
  let savedBindings: AutoscalingConfig[] = [];
  return (candidate: ResourceCandidate): string | undefined => {
    let bindings: ReturnType<typeof bindingValidator> | undefined;
    const checkBindings = (a: unknown) => {
      const config = a as AutoscalingConfig | undefined;
      if (fragment || config?.mode !== "on" || config.controller.kind !== "keda") return true;
      bindings ??= bindingValidator(
        candidate.nodes.map((n) => ({ id: n.id, stencil: n.stencil ?? "" })),
        candidate.edges ?? [],
      );
      return bindings(config);
    };
    const next = new Map<string, { resources: unknown; autoscaling: unknown; replicas: unknown }>();
    let budgetChanged =
      !initialized || simulations !== candidate.simulations || revision !== candidate.planning?.revision;
    const check = (props: Record<string, unknown> | undefined) => {
      if (
        candidate.planning?.revision !== "p3-a1" &&
        (props?.resources !== undefined || props?.autoscaling !== undefined)
      )
        return t("autoscaling.modelRequired");
      try {
        checkAutoscaling(props?.resources, props?.autoscaling);
        if (!checkBindings(props?.autoscaling)) return t("autoscaling.bindingRequired");
      } catch {
        return t("autoscaling.checkInvalid");
      }
    };
    for (const node of candidate.nodes) {
      const entry = {
        resources: node.props?.resources,
        autoscaling: node.props?.autoscaling,
        replicas: node.props?.replicas,
      };
      const old = previous.get(node.id);
      if (
        !initialized ||
        revision !== candidate.planning?.revision ||
        !old ||
        old.resources !== entry.resources ||
        old.autoscaling !== entry.autoscaling
      ) {
        const error = check(node.props);
        if (error) return error;
        budgetChanged = true;
      } else if (!checkBindings(node.props?.autoscaling)) return t("autoscaling.bindingRequired");
      if (old?.replicas !== entry.replicas) budgetChanged = true;
      next.set(node.id, entry);
    }
    const changedPatches =
      !initialized || simulations !== candidate.simulations || revision !== candidate.planning?.revision;
    const nextBindings: AutoscalingConfig[] = [];
    if (changedPatches) {
      for (const sim of candidate.simulations ?? []) {
        const patches = [
          ...Object.values(sim.setup?.props ?? {}),
          ...(sim.timeline ?? []).flatMap((step) => (step.action.do === "props" ? [step.action.props] : [])),
        ];
        for (const patch of patches) {
          const error = check(patch);
          if (error) return error;
          const a = patch.autoscaling as AutoscalingConfig | undefined;
          if (a?.mode === "on" && a.controller.kind === "keda") nextBindings.push(a);
        }
      }
    } else for (const a of savedBindings) if (!checkBindings(a)) return t("autoscaling.bindingRequired");
    budgetChanged ||= next.size !== previous.size;
    if (budgetChanged && resourceBudgetExceeded(candidate))
      return t("autoscaling.budget", { limit: MAX_LIFECYCLE_REPLICAS });
    if (changedPatches) savedBindings = nextBindings;
    previous = next;
    simulations = candidate.simulations;
    revision = candidate.planning?.revision;
    initialized = true;
  };
}
