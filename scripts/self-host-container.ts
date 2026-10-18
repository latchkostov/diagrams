import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

/** Require consecutive HTTP successes: an isolated ready response can precede Docker network churn. */
export async function waitForStableEndpoint(
  url: string,
  probe = async (address: string) => {
    const response = await fetch(address, { signal: AbortSignal.timeout(2_000), cache: "no-store" });
    await response.arrayBuffer();
    return response.ok;
  },
  pause: () => Promise<unknown> = () => setTimeout(500),
): Promise<void> {
  let consecutive = 0;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      consecutive = (await probe(url)) ? consecutive + 1 : 0;
    } catch {
      consecutive = 0;
    }
    if (consecutive === 3) return;
    if (attempt < 59) await pause();
  }
  throw new Error(`Container endpoint did not answer steadily: ${url}`);
}

type Run = (command: string, args: string[], capture?: boolean) => string;

/** Own the container before starting it; even a failed start may leave a container behind. */
export async function withSmokeContainer(
  run: Run,
  image: string,
  check: (container: { id: string; origin: string }) => Promise<void>,
): Promise<void> {
  const id = run(
    "docker",
    [
      "create",
      "--name",
      `live-diagrams-smoke-${randomUUID()}`,
      "--read-only",
      "--tmpfs",
      "/tmp:uid=101,gid=101",
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges:true",
      "-p",
      "127.0.0.1::8080",
      image,
    ],
    true,
  ).trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("docker create did not return a container ID");
  try {
    run("docker", ["start", id]);
    const binding = run("docker", ["port", id, "8080/tcp"], true).trim();
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error(`Unexpected container binding: ${binding}`);
    await check({ id, origin: `http://${binding}` });
  } finally {
    run("docker", ["rm", "-f", id]);
  }
}
