/** Read every context frame: Playwright's clock commands apply to the whole context. */
export async function pauseClocks(sample: () => Promise<number[]>, pause: (time: number) => Promise<void>) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pause(Math.max(...(await sample())));
      return;
    } catch (error) {
      // The first rejection has already paused the clocks. Sample them standing;
      // a fixed margin still races an arbitrarily loaded machine.
      if (attempt >= 3 || !String(error).includes("Cannot fast-forward to the past")) throw error;
    }
  }
}
