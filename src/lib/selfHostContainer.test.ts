import { describe, expect, it, vi } from "vitest";
import { withSmokeContainer } from "../../scripts/self-host-container";

const owned = "a".repeat(64);
const existing = "b".repeat(64);

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
