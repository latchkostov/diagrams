import { checkAutoscaling } from "./autoscalingSchema";
import { resourceBudgetExceeded, MAX_LIFECYCLE_REPLICAS, type ResourceCandidate } from "./resourceBudget";
import { t } from "../i18n/core";
import { bindingValidator, loadBalancerSources, scalerTriggers } from "./kedaBindings";
import type { AutoscalingConfig } from "./autoscaling";

/** Persisted-resource rules shared by native reads and editor transactions. Cache only immutable editor inputs. */
export function createResourceValidator({ fragment = false } = {}) {
  let previous = new Map<string, { resources: unknown; autoscaling: unknown; replicas: unknown }>();
  let simulations: ResourceCandidate["simulations"];
  let revision: string | undefined;
  let initialized = false;
  let savedBindings: { node: string; config: AutoscalingConfig }[] = [];
  return (candidate: ResourceCandidate): string | undefined => {
    let bindings: ReturnType<typeof bindingValidator> | undefined;
    const checkBindings = (a: unknown, node: string) => {
      const config = a as AutoscalingConfig | undefined;
      if (fragment || (!scalerTriggers(config).length && !loadBalancerSources(config).length)) return true;
      bindings ??= bindingValidator(
        candidate.nodes.map((n) => ({
          id: n.id,
          stencil: n.stencil ?? "",
          label: n.label ?? "",
          sublabel: n.sublabel,
        })),
        candidate.edges ?? [],
      );
      return bindings(config, node);
    };
    const next = new Map<string, { resources: unknown; autoscaling: unknown; replicas: unknown }>();
    let budgetChanged =
      !initialized || simulations !== candidate.simulations || revision !== candidate.planning?.revision;
    const check = (props: Record<string, unknown> | undefined, node: string) => {
      if (
        candidate.planning?.revision !== "p3-a1" &&
        candidate.planning?.revision !== "p3-w1" &&
        (props?.resources !== undefined || props?.autoscaling !== undefined)
      )
        return t("autoscaling.modelRequired");
      try {
        checkAutoscaling(props?.resources, props?.autoscaling);
        if (!checkBindings(props?.autoscaling, node)) return t("autoscaling.bindingInvalid");
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
        const error = check(node.props, node.id);
        if (error) return error;
        budgetChanged = true;
      } else if (!checkBindings(node.props?.autoscaling, node.id)) return t("autoscaling.bindingInvalid");
      if (old?.replicas !== entry.replicas) budgetChanged = true;
      next.set(node.id, entry);
    }
    const changedPatches =
      !initialized || simulations !== candidate.simulations || revision !== candidate.planning?.revision;
    const nextBindings: { node: string; config: AutoscalingConfig }[] = [];
    if (changedPatches) {
      for (const sim of candidate.simulations ?? []) {
        const patches = [
          ...Object.entries(sim.setup?.props ?? {}),
          ...(sim.timeline ?? []).flatMap((step) =>
            step.action.do === "props" ? [[step.action.node, step.action.props] as const] : [],
          ),
        ];
        for (const [node, patch] of patches) {
          const error = check(patch, node);
          if (error) return error;
          const a = patch.autoscaling as AutoscalingConfig | undefined;
          if (scalerTriggers(a).length || loadBalancerSources(a).length) nextBindings.push({ node, config: a! });
        }
      }
    } else
      for (const saved of savedBindings)
        if (!checkBindings(saved.config, saved.node)) return t("autoscaling.bindingInvalid");
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
