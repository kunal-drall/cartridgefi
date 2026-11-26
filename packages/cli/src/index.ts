#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, type CliIo } from "./cli-runner.js";

export const CLI_VERSION = "2.0.0";
export { runCli, type CliIo };
export * from "./templates.js";

function isDirectCliInvocation(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    const currentFile = fileURLToPath(import.meta.url);
    return (
      path.resolve(entryArg) === path.resolve(currentFile) ||
      entryArg.endsWith("/cartridgefi") ||
      entryArg.endsWith("\\cartridgefi")
    );
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
