import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";
import console from "node:console";
import { command, required } from "./commands.mjs";
import { imageName } from "./doctor.mjs";

export async function linuxRun(root, config, changed, directory, sha) {
  const image = imageName(root);
  const platform = await command("docker", ["info", "--format", "{{.OSType}}-{{.Architecture}}"]);
  if (platform.code) throw new Error("Docker is unavailable");
  const hash = createHash("sha256")
    .update(readFileSync(join(root, "pnpm-lock.yaml")))
    .digest("hex")
    .slice(0, 16);
  const modules = `livediagrams-gate-modules-${platform.text.trim()}-${hash}`;
  const name = `ld-gate-${process.pid}`;
  const source = `${name}-source`;
  // Full gates export exactly HEAD, with no untracked/ignored host content. Quick
  // gates include working edits. GATE_LINUX_SOURCE=bind exists only for measurement.
  const archive = config.command === "full" && process.env.GATE_LINUX_SOURCE !== "bind";
  const innerDir = `/work/tests/.output/g/${basename(directory)}`;
  console.log(`Linux source: ${archive ? "git archive HEAD → Linux volume" : "bind mount"}; dependencies: ${modules}`);
  try {
    if (archive) {
      const tar = join(directory, "head.tar");
      await required("git", ["archive", "--format=tar", `--output=${tar}`, sha], { cwd: root });
      await required("docker", ["volume", "create", source]);
      const unpack = `${name}-unpack`;
      await required("docker", [
        "create",
        "--name",
        unpack,
        "-v",
        `${source}:/work`,
        image,
        "tar",
        "-xf",
        "/head.tar",
        "-C",
        "/work",
      ]);
      try {
        await required("docker", ["cp", tar, `${unpack}:/head.tar`]);
        await required("docker", ["start", "--attach", unpack]);
      } finally {
        await command("docker", ["rm", "-f", unpack], { cleanup: true });
      }
    }
    const innerConfig = { ...config, linux: false };
    const args = [
      "run",
      "--name",
      name,
      "--ipc=host",
      "-v",
      archive ? `${source}:/work` : `${root}:/work`,
      "-v",
      `${modules}:/work/node_modules`,
      "-v",
      "livediagrams-gate-pnpm-store:/pnpm-store",
      "-v",
      `${directory}:${innerDir}`,
      "-w",
      "/work",
      "-e",
      "pnpm_config_store_dir=/pnpm-store",
      "-e",
      "npm_config_engine_strict=false",
      "-e",
      "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
      "-e",
      "GATE_CONTAINER=1",
      "-e",
      "PARITY_CONTAINER=1",
      "-e",
      `VERCEL_GIT_COMMIT_SHA=${sha}`,
      ...(typeof process.getuid === "function" ? ["-e", `GATE_OWNER=${process.getuid()}:${process.getgid()}`] : []),
      image,
      "node",
      "scripts/gate/container.mjs",
      JSON.stringify({ config: innerConfig, changed, directory: innerDir }),
    ];
    // No shell on either side: Docker receives literal POSIX paths even under MSYS.
    const result = await command("docker", args, { cwd: root, live: true, log: join(directory, "container.log") });
    const summary = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
    if (result.code && !summary.failures) summary.failures++;
    return summary;
  } finally {
    for (const folder of ["parity", "parity-results", "coverage"])
      await command(
        "docker",
        ["cp", `${name}:/work/${folder === "coverage" ? folder : `tests/.output/${folder}`}`, join(directory, folder)],
        { cleanup: true },
      );
    await command("docker", ["rm", "-f", name], { cleanup: true });
    if (archive) await command("docker", ["volume", "rm", source], { cleanup: true });
  }
}
