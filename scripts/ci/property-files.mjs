import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";

const agreement = "src/sim/cacheAgreement.test.ts";

/** All observations for an aggregate stay in their existing seed batch; pinned cases run once in batch zero. */
export function agreementPattern(shard) {
  const batch = /^agreement-([0-4])$/.exec(shard)?.[1];
  if (batch === undefined) throw new Error(`Unknown agreement shard: ${shard}`);
  return `batch ${batch}[,)]${batch === "0" ? "|^(?!.*batch [0-4][,)])" : ""}`;
}

/** Keep each file in exactly one lane; Vitest partitions the ordinary lane into four shards. */
export function propertyFiles(files, shard) {
  const isAgreement = /^agreement-[0-4]$/.test(shard);
  if (!isAgreement && !["1", "2", "3", "4"].includes(shard)) throw new Error(`Unknown property shard: ${shard}`);
  return files.filter((file) => (file === agreement) === isAgreement);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[3] === "--pattern") {
    console.log(agreementPattern(process.argv[2]));
  } else {
    const files = execFileSync(
      "git",
      ["grep", "-l", 'from "fast-check"', "--", "src/**/*.test.ts", "src/**/*.test.tsx"],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\r?\n/);
    console.log(propertyFiles(files, process.argv[2]).join("\n"));
  }
}
