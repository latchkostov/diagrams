// Keep Git's path list out of both Windows command-line limits and shell parsing.
import { readFileSync } from "node:fs";
import process from "node:process";
import { parseCLI, startVitest } from "vitest/node";

const related = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(related) || !related.length || related.some((path) => typeof path !== "string"))
  throw new Error("Expected a nonempty JSON array of related paths");
const { options } = parseCLI(["vitest", "run", "--passWithNoTests", ...process.argv.slice(3)]);
await startVitest([], { ...options, related });
