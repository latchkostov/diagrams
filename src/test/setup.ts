import fc from "fast-check";
import process from "node:process";
import { fastCheckConfig } from "./fastCheck";

// Keep fast-check's default failure reporter: it prints both seed and shrink path.
fc.configureGlobal(fastCheckConfig(process.env));
