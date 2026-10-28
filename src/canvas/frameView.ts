import type { DetailView } from "./detail";

/** A selected subset panned into view is Focus even when the preceding whole fit was Overview. */
export function frameView(view: DetailView, selected: number, outside: boolean): DetailView {
  return view === "overview" && selected === 1 && outside ? "focus" : view;
}
