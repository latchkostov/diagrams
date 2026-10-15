import { randomUUID } from "node:crypto";

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
