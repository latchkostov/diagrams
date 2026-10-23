import { describe, expect, it, vi } from "vitest";
import { waitForStableEndpoint, withSmokeContainer } from "../../scripts/self-host-container";

const owned = "a".repeat(64);
const existing = "b".repeat(64);

it("waits for consecutive endpoint responses before navigation, resetting on errors and HTTP failures", async () => {
  const responses = [false, true, true, new Error("ERR_NETWORK_CHANGED"), true, false, true, true, true];
  const probe = vi.fn(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response === true;
  });
  const pause = vi.fn(async () => {});
  await waitForStableEndpoint("http://container/deep/route", probe, pause);
  expect(probe).toHaveBeenCalledTimes(9);
  expect(probe).toHaveBeenLastCalledWith("http://container/deep/route");
  expect(pause).toHaveBeenCalledTimes(8);
});

it("fails readiness without navigating if the endpoint never stays ready", async () => {
  const probe = vi.fn(async () => probe.mock.calls.length % 3 !== 0);
  const pause = vi.fn(async () => {});
  await expect(waitForStableEndpoint("http://container", probe, pause)).rejects.toThrow("did not answer steadily");
  expect(probe).toHaveBeenCalledTimes(60);
  expect(pause).toHaveBeenCalledTimes(59);
});

describe("self-host smoke container ownership", () => {
  function docker(fail?: "create" | "start") {
    const containers = new Set([existing]);
    const run = vi.fn((_command: string, args: string[]) => {
      if (args[0] === fail) throw new Error(`failed ${fail}`);
      if (args[0] === "create") {
        containers.add(owned);
        return `${owned}\n`;
      }
      if (args[0] === "port") return "127.0.0.1:6229\n";
      if (args[0] === "rm") containers.delete(args[2]);
      return "";
    });
    return { containers, run };
  }

  it("failed container start preserves an existing container", async () => {
    const { containers, run } = docker("start");
    const check = vi.fn();
    await expect(withSmokeContainer(run, "image", check)).rejects.toThrow("failed start");
    expect(containers).toEqual(new Set([existing]));
    expect(run.mock.calls.filter(([, args]) => args[0] === "rm")).toEqual([["docker", ["rm", "-f", owned]]]);
    expect(check).not.toHaveBeenCalled();
  });

  it("runs the server with a read-only root and no writable mounts, passing runtime base and relay mode", async () => {
    const { run } = docker();
    await withSmokeContainer(run, "server", async () => {}, {
      server: true,
      env: { LD_BASE: "/tools/diagrams/", LD_STATIC: "off" },
    });
    const args = run.mock.calls[0][1];
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("no-new-privileges:true");
    expect(args).not.toContain("--tmpfs");
    expect(args).toContain("LD_BASE=/tools/diagrams/");
    expect(args).toContain("LD_STATIC=off");
  });

  it("starts the browser CLI on Docker's isolated default network with only its package mounted read-only", async () => {
    const { run } = docker();
    await withSmokeContainer(run, "browser-image", async () => {}, {
      mounts: { "/packages/playwright-core": "/playwright" },
      command: ["node", "/playwright/cli.js", "run-server"],
    });
    const args = run.mock.calls[0][1];
    expect(args).toContain("/packages/playwright-core:/playwright:ro");
    expect(args).not.toContain("--network");
    expect(args).toContain("--read-only");
    expect(args.slice(-4)).toEqual(["browser-image", "node", "/playwright/cli.js", "run-server"]);
  });

  it("prints container logs before removal, retaining the check failure even if log collection fails", async () => {
    const { run } = docker();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("app did not boot");
    const original = run.getMockImplementation()!;
    run.mockImplementation((command, args) => {
      if (args[0] === "logs") throw new Error("unavailable logs");
      return original(command, args);
    });
    try {
      await expect(
        withSmokeContainer(run, "image", async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      const commands = run.mock.calls.map(([, args]) => args[0]);
      expect(commands.indexOf("logs")).toBeGreaterThan(commands.indexOf("port"));
      expect(commands.indexOf("rm")).toBeGreaterThan(commands.indexOf("logs"));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("failed creation never removes a container it did not create", async () => {
    const { containers, run } = docker("create");
    await expect(withSmokeContainer(run, "image", vi.fn())).rejects.toThrow("failed create");
    expect(containers).toEqual(new Set([existing]));
    expect(run.mock.calls.some(([, args]) => args[0] === "rm")).toBe(false);
  });

  it("uses unique names, assigned ports and the owned ID, including when checks fail", async () => {
    const names = new Set<string>();
    for (const fail of [false, true]) {
      const { run, containers } = docker();
      const result = withSmokeContainer(run, "image", async ({ id, origin }) => {
        expect(id).toBe(owned);
        expect(origin).toBe("http://127.0.0.1:6229");
        if (fail) throw new Error("check failed");
      });
      if (fail) await expect(result).rejects.toThrow("check failed");
      else await result;
      const args = run.mock.calls[0][1];
      names.add(args[args.indexOf("--name") + 1]);
      expect(args[args.indexOf("-p") + 1]).toBe("127.0.0.1::8080");
      expect(containers).toEqual(new Set([existing]));
    }
    expect(names.size).toBe(2);
  });
});
