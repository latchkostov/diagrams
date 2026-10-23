import { memo, useMemo } from "react";
import { useStore, type InternalNode } from "@xyflow/react";
import { routeInputFromStore, useAllRoutes, useRoutingOptions } from "../canvas/edges/useEdgeRoute";
import type { FlowNode } from "../canvas/types";
import { callPillObstacles, placeCallPills, type PillSize } from "./callPillPlacement";
import { t, useLocale } from "../i18n";
export { ThreadMeter } from "./ThreadMeter";

export interface ActiveCall {
  breaker?: import("../sim/breaker").BreakerView;
  windowRequests?: number;
  windowAttempts?: number;
  windowRetried?: number;
  attempts?: number;
  retried?: number;
  failed?: number;
  budgetDenied?: number;
  id: string;
  held: number;
  inFlight: number;
  timedOut?: number;
  queued?: number;
  pool?: number;
  from?: string;
  to?: string;
}

/** One shared placement pass: inactive connections never mount routing consumers. */
export const CallPills = memo(
  function CallPills({
    calls,
    readoutScale = 1,
    presenting = false,
  }: {
    calls: ActiveCall[];
    readoutScale?: number;
    presenting?: boolean;
  }) {
    useLocale();
    const options = useRoutingOptions();
    const routes = useAllRoutes(options);
    const nodes = useStore((s) => s.nodeLookup as Map<string, InternalNode<FlowNode>>);
    const [tx, ty, zoom] = useStore((s) => s.transform);
    const viewWidth = useStore((s) => s.width);
    const viewHeight = useStore((s) => s.height);
    const { style, direction, captions, hideDependencies } = options;
    const obstacles = useMemo(() => {
      const input = routeInputFromStore(nodes.values(), [], { style, direction, captions, hideDependencies });
      return callPillObstacles([
        ...input.nodes.flatMap((n) => [
          n.rect,
          ...(n.extra ? [n.extra] : []),
          // Reserve the live busy-thread / in-flight strips, including their counter-scaling.
          {
            x: n.rect.x,
            y: n.rect.y + n.rect.height + 7,
            width: Math.max(320, n.rect.width) * readoutScale,
            height: (presenting ? 26 : 21) * readoutScale,
          },
        ]),
        ...(input.groups ?? []).map((g) => g.header),
        ...[...routes.values()].flatMap((r) =>
          r.label
            ? [
                {
                  x: r.label.x - r.label.width / 2,
                  y: r.label.y - r.label.height / 2,
                  width: r.label.width,
                  height: r.label.height,
                },
              ]
            : [],
        ),
      ]);
    }, [nodes, routes, style, direction, captions, hideDependencies, readoutScale, presenting]);
    const labels = calls.map(
      ({ id, held, inFlight, timedOut, queued = 0, pool, from = "", to = "", breaker, ...retry }) => {
        const amplification = (retry.windowRequests ?? 0) > 0 ? (retry.windowAttempts ?? 0) / retry.windowRequests! : 1;
        const showRetry = amplification >= 1.2 && (retry.windowRetried ?? 0) >= 10;
        const label = {
          id,
          timedOut,
          title: held
            ? t("threads.pillHeldTitle", { count: held, from, to })
            : t("threads.pillFreeTitle", { count: inFlight, queued, from, to }),
          text:
            pool && (held || inFlight || queued) && held
              ? t("threads.pillPoolHeld", { count: inFlight, queued, timedOut: timedOut ?? 0 })
              : pool && (inFlight || queued)
                ? t("threads.pillPoolFree", { count: inFlight, pool, queued, timedOut: timedOut ?? 0 })
                : timedOut
                  ? t("threads.pillTimeout", { count: timedOut })
                  : held
                    ? t("threads.pillHeld", { count: held })
                    : t("threads.pillFlight", { count: inFlight }),
        };
        if (breaker && breaker.state !== "closed")
          return {
            ...label,
            timedOut: breaker.state === "open" ? 1 : 0,
            text:
              breaker.state === "open"
                ? t("resilience.breakerOpen", { seconds: Math.ceil(breaker.remainingMs / 1000) })
                : t("resilience.breakerTesting", { sent: breaker.probesSettled, probes: breaker.probes }),
            title: t("resilience.breakerTitle", {
              from,
              to,
              percent: Math.round(breaker.failurePercent),
              count: breaker.calls,
            }),
          };
        return showRetry
          ? {
              ...label,
              text: t("resilience.pill", {
                calls: label.text,
                ratio: amplification.toFixed(1),
                budget: retry.budgetDenied ? t("resilience.budgetUsed") : "",
              }),
              title: t("resilience.pillTitle", {
                from,
                attempts: ((retry.windowAttempts ?? 0) / 10).toFixed(1),
                requests: ((retry.windowRequests ?? 0) / 10).toFixed(1),
                retried: retry.retried ?? 0,
                percent: Math.round((100 * (retry.failed ?? 0)) / Math.max(1, retry.attempts ?? 0)),
              }),
            }
          : label;
      },
    );
    // Count changes of the same text dimensions reuse the entire placement pass.
    const dimensions = JSON.stringify(
      labels.map(({ id, text }) => ({ id, width: (text.length * 7 + 16) * readoutScale, height: 20 * readoutScale })),
    );
    const placements = useMemo(
      () =>
        placeCallPills(JSON.parse(dimensions) as PillSize[], routes, obstacles, {
          x: -tx / zoom,
          y: -ty / zoom,
          width: viewWidth / zoom,
          height: viewHeight / zoom,
        }),
      [dimensions, routes, obstacles, tx, ty, zoom, viewWidth, viewHeight],
    );
    return labels.map(({ id, text, title, timedOut }) => {
      const box = placements.get(id);
      if (!box) return null;
      return (
        <span
          key={id}
          className={`lv-call-pill${timedOut ? " is-timeout" : ""}`}
          style={{ left: box.x, top: box.y, transform: `scale(${readoutScale})`, transformOrigin: "top left" }}
          data-call-edge={id}
          aria-label={`${text} · ${title}`}
          data-testid={`call-pill-${id}`}
        >
          {text}
        </span>
      );
    });
  },
  (a, b) =>
    a.readoutScale === b.readoutScale &&
    a.presenting === b.presenting &&
    a.calls.length === b.calls.length &&
    a.calls.every(
      (c, i) =>
        JSON.stringify(c.breaker) === JSON.stringify(b.calls[i].breaker) &&
        c.windowRequests === b.calls[i].windowRequests &&
        c.windowAttempts === b.calls[i].windowAttempts &&
        c.windowRetried === b.calls[i].windowRetried &&
        c.budgetDenied === b.calls[i].budgetDenied &&
        c.retried === b.calls[i].retried &&
        c.failed === b.calls[i].failed &&
        c.attempts === b.calls[i].attempts &&
        c.id === b.calls[i].id &&
        c.held === b.calls[i].held &&
        c.inFlight === b.calls[i].inFlight &&
        c.timedOut === b.calls[i].timedOut &&
        c.queued === b.calls[i].queued &&
        c.pool === b.calls[i].pool &&
        c.from === b.calls[i].from &&
        c.to === b.calls[i].to,
    ),
);
