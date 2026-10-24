import { expect, it, vi } from "vitest";
import { duringStartup } from "../../scripts/smoke-startup";

for (const phase of ["browser", "context"] as const) {
  it(`churns while ${phase} startup is pending and waits for both acknowledgements`, async () => {
    let churned!: () => void;
    const resource = { close: vi.fn(async () => {}) };
    let connected!: (value: typeof resource) => void;
    const start = vi.fn(
      () =>
        new Promise<typeof resource>((resolve) => {
          connected = resolve;
        }),
    );
    const probe = vi.fn((at: string) => {
      expect(at).toBe(phase);
      expect(start).toHaveBeenCalledOnce();
      return new Promise<void>((resolve) => {
        churned = resolve;
      });
    });
    let complete = false;
    const result = duringStartup(phase, start, probe).then((value) => {
      complete = true;
      return value;
    });
    expect(probe).toHaveBeenCalledOnce();
    connected(resource);
    await Promise.resolve();
    expect(complete).toBe(false);
    churned();
    expect(await result).toBe(resource);
    expect(resource.close).not.toHaveBeenCalled();
  });

  it(`closes the ${phase} if network churn fails, even when startup completes later`, async () => {
    const resource = { close: vi.fn(async () => {}) };
    let connected!: (value: typeof resource) => void;
    const failure = new Error("Docker bridge failed");
    const result = duringStartup(
      phase,
      () =>
        new Promise<typeof resource>((resolve) => {
          connected = resolve;
        }),
      async () => {
        throw failure;
      },
    );
    const rejected = expect(result).rejects.toBe(failure);
    connected(resource);
    await rejected;
    expect(resource.close).toHaveBeenCalledOnce();
  });
}
