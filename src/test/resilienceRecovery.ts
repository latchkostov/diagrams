import type { DiagramFile } from "../model/types";
import type { NodeSimProps, EdgeSimProps } from "../sim/types";
import { backoffDelay } from "../sim/retryPolicy";

/** A serial upper bound for this generator's finite DAG, not a fixed request lifetime.
 * Count every retry's surviving downstream work, even after its parent times out.
 * Serializing all real messages also covers one-slot pools/shared admission and sampling waves. */
export function recoveryWorkMs(diagram: DiagramFile, scale: number, roots = 4): number {
  const work = (id: string): number => {
    const props = diagram.nodes.find((n) => n.id === id)?.props as NodeSimProps | undefined;
    const resources = props?.resources;
    const cpuRate = resources
      ? Math.min(1, (resources.cpuLimitMilli ?? resources.availableCpuMilli ?? 1000) / 1000)
      : 1;
    let ms =
      1000 +
      (props?.latencyMs ?? 250) +
      (props?.api?.latencyMs ?? 0) +
      (props?.retryBackoffMs ?? 1000) +
      (resources?.cpuMsPerMessage ?? 0) / cpuRate +
      (resources?.terminationGraceMs ?? 0);
    for (const edge of diagram.edges.filter((edge) => edge.from === id)) {
      const p = edge.props as EdgeSimProps | undefined;
      const retry = p?.caller?.retry;
      const attempts = retry?.maxAttempts ?? 1;
      ms +=
        attempts *
        (1000 +
          (p?.travelMs ?? 300) * 2 +
          (p?.networkDelayMs ?? 0) * 2 +
          (p?.caller?.replyMs ?? 0) +
          (p?.caller?.deadlineMs ?? 0) +
          work(edge.to));
      if (retry) for (let k = 1; k < attempts; k++) ms += backoffDelay(retry, k);
    }
    return ms;
  };
  const deliveries = Number(diagram.nodes.find((n) => n.id === "source")?.props?.maxDeliveryCount ?? 1);
  // Four sampled roots represent 4*scale real messages; each slot wave stretches by at most scale.
  return roots * Math.max(1, scale) ** 2 * deliveries * work("source");
}
