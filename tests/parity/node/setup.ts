import { beforeAll } from "vitest";
import { loadShapedRoutes } from "../../../src/canvas/geometry/shapedRuntime";
beforeAll(loadShapedRoutes);
// Every parity file starts in English with nothing mocked: the i18n runtime's state is module-global, and a
// language left over from one test would change another's validation messages. After each test, every golden it
// changed is reported at once (tests/parity/lib/golden.ts).
import { afterEach, beforeEach } from "vitest";
import { state } from "../../../src/i18n";
import { assertGoldens } from "../lib/golden";

function english(): void {
  state.l = "en";
  state.c = undefined;
  state.a = undefined;
}

beforeEach(english);
afterEach(() => {
  english();
  assertGoldens();
});
