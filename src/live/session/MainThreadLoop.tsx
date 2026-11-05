import { MainThreadRenderer } from "../mainThreadRenderer";
import { RendererLoop, type RendererLoopProps } from "./RendererLoop";
import type { RendererSetup } from "../liveRenderer";
const createRenderer = (setup: RendererSetup) => new MainThreadRenderer(setup);
/** Only browsers using the main-thread fallback download its drawing implementation. */
export function MainThreadLoop(props: RendererLoopProps) {
  return <RendererLoop {...props} createRenderer={createRenderer} />;
}
