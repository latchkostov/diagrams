import { parentPort, workerData } from "node:worker_threads";
import { Buffer } from "node:buffer";
import { zipSkill } from "./skill-zip.ts";

const files = workerData.map(({ name, data }) => ({ name, data: Buffer.from(data) }));
parentPort.postMessage(await zipSkill(files));
