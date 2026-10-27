import type { ReactNode } from "react";
import type { Simulation } from "../model/types";
import type { SimulationRunState } from "../sim/types";
import { RunStrip } from "./RunStrip";
import { SimulationExpectations } from "./ExpectationSummary";

interface TimelineProps {
  sim: Simulation;
  run: SimulationRunState;
  onSeek(ms: number): void;
  disabled?: boolean;
  viewControl?: ReactNode;
}
export function Timeline(props: TimelineProps) {
  return <RunStrip run={props.run} onSeek={props.onSeek} disabled={props.disabled} />;
}
export function SimulationTimeline(props: TimelineProps) {
  const expectations = props.run.expectations ?? [];
  return (
    <>
      <Timeline {...props} />
      {props.viewControl}
      {expectations.length > 0 && (
        <SimulationExpectations
          expectations={expectations}
          passed={expectations.filter((e) => e.status === "pass").length}
          failed={expectations.some((e) => e.status === "fail")}
          done={!!props.run.done}
        />
      )}
    </>
  );
}
