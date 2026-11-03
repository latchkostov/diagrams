import { watchCheckpoints } from "../test/checkpointProbe";
import { expect, it } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { LiveController } from "./controller";
import { emptyInputs } from "./playbackInputs";

it("warms restarted Free play from its actual starting Inputs", () => {
  const controller = new LiveController(cacheFixture(), { seed: 7 });
  controller.setInputs({ ...emptyInputs(), traffic: 4 });
  controller.flush();
  controller.restart();
  const probe = watchCheckpoints();
  const ahead = controller.lookAhead();
  try {
    const cache = probe.sources[0][0].get("cache")!.cache!;
    expect(cache.rules[0].rate.planned).toBe(800);
    expect([...cache.rules[0].rate.buckets].slice(1)).toEqual(Array(9).fill(800));
  } finally {
    ahead.restore();
    probe.stop();
    controller.dispose();
  }
});
