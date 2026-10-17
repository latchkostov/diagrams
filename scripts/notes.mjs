import path from "node:path";
import process from "node:process";
import console from "node:console";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const { combinedNotes, streams } = (await runnerImport(path.join(root, "scripts/fragments.ts"), { configFile: false }))
  .module;
const stream = process.argv[2] ?? "release";
if (!(stream in streams)) throw new Error("Usage: pnpm notes [release | design | backlog]");
console.log(combinedNotes(root, stream));
