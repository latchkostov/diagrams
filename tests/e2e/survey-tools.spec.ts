import { test, expect } from "./fixtures";
import { runSurveySimulations } from "../bench/ui/survey2Checks";

for (const [status, notes, complete] of [
  ["Played 2 simulations · no messages lost", "", true],
  ["Played 2 simulations", "", true],
  ["Played 1 simulation · no messages lost", "Out of time before one more: not counted.", false],
  ["The simulations are too big to play here.", "", false],
  ["Played 2 simulations · no messages lost", "One starts too much traffic to play here: not counted.", false],
] as const)
  test(`survey2 ${complete ? "accepts complete" : "rejects incomplete"} simulation runs: ${status} ${notes}`, async ({
    page,
  }) => {
    await page.setContent(`
      <button data-testid="context-menu-item-canvas.run-simulations">Run simulations</button>
      <div data-testid="checks-simulations" data-status="ready">
        <p data-testid="checks-simulations-status"></p>
        <ul data-testid="checks-simulations-notes"></ul>
      </div>`);
    await page.evaluate(
      ({ status, notes }) => {
        const stats = { finished: 0 };
        Object.assign(window, { __simulations: stats });
        const run = document.querySelector('[data-testid="context-menu-item-canvas.run-simulations"]');
        const card = document.querySelector('[data-testid="checks-simulations"]');
        const summary = document.querySelector('[data-testid="checks-simulations-status"]');
        const details = document.querySelector('[data-testid="checks-simulations-notes"]');
        if (!run || !card || !summary || !details) throw new Error("Missing survey fixture");
        run.addEventListener("click", () => {
          // Fulfilled evidence with either a complete or partial result.
          stats.finished++;
          card.setAttribute("data-status", "done");
          summary.textContent = status;
          details.textContent = notes;
        });
      },
      { status, notes },
    );
    if (complete) await runSurveySimulations(page, 2);
    else await expect(runSurveySimulations(page, 2)).rejects.toThrow("Incomplete survey simulation run");
  });
