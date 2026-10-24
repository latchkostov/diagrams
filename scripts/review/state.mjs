import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { acquireLock } from "../gate/host.mjs";

export const readState = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);

/** Serialize the comparison and replacement, not just the final atomic rename. */
export async function replaceState(file, expected, replacement, waiting = () => {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const key = path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  const unlock = await acquireLock(key, process.platform, waiting, undefined, globalThis.AbortSignal.timeout(30_000));
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    if (JSON.stringify(readState(file)) !== JSON.stringify(expected))
      throw new Error("Another review advanced state; state was not overwritten");
    fs.writeFileSync(temporary, JSON.stringify(await replacement(), null, 2));
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
    await unlock();
  }
}
